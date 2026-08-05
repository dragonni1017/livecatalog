import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { validateOrderInput, validateOrderMinimum } from '@/lib/order-validation'
import { notifyReps, notifyCustomer } from '@/lib/order-emails'
import { getEffectivePrice, type VolumeTier } from '@/lib/order-rules'

export const dynamic = 'force-dynamic'

function isMockMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return !url || url === 'your-supabase-url' || url.includes('placeholder')
}

// ORD-<year>-<4-digit sequence>. Sequence derived from this year's order count.
// The reference_code unique constraint guards against concurrent collisions;
// the caller retries with the next number if the RPC returns a 23505 violation.
async function nextReferenceCode(
  db: ReturnType<typeof getAdminClient>,
  attempt: number,
): Promise<string> {
  const year = new Date().getFullYear()
  const { count } = await db
    .from('order_requests')
    .select('id', { count: 'exact', head: true })
    .like('reference_code', `ORD-${year}-%`)
  const seq = (count ?? 0) + 1 + attempt
  return `ORD-${year}-${String(seq).padStart(4, '0')}`
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // ── 1. Validate input (Django form-validation pattern) ───────────────────
    const validation = validateOrderInput(body)
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }
    const { contact, items } = validation

    if (isMockMode()) {
      return NextResponse.json({ referenceCode: 'ORD-MOCK-0001', orderId: 'mock' })
    }

    const db = getAdminClient()

    // ── 2. Re-fetch authoritative product data (never trust client prices) ───
    const { data: products, error: prodErr } = await db
      .from('products')
      .select('id, sku, name, price_cents, stock_qty, is_active, manually_hidden, volume_tiers')
      .in('id', items.map((i) => i.productId))

    if (prodErr) {
      console.error('[orders] product lookup failed:', prodErr.message)
      return NextResponse.json({ error: 'Could not validate cart. Please try again.' }, { status: 500 })
    }

    const byId = new Map((products ?? []).map((p) => [p.id, p]))
    const lineItems: {
      product_id: string; sku: string; name: string
      unit_price_cents: number; qty: number; line_total_cents: number
    }[] = []
    const outOfStock: string[] = []

    for (const item of items) {
      const p = byId.get(item.productId)
      if (!p || !p.is_active || p.manually_hidden) continue
      if (p.stock_qty < item.qty) {
        outOfStock.push(`${p.sku} (${p.name}) — ${p.stock_qty} in stock, ${item.qty} requested`)
      }
      const unitPrice = getEffectivePrice(p.price_cents, item.qty, p.volume_tiers as VolumeTier[] | null)
      lineItems.push({
        product_id: p.id, sku: p.sku, name: p.name,
        unit_price_cents: unitPrice, qty: item.qty,
        line_total_cents: unitPrice * item.qty,
      })
    }

    if (lineItems.length === 0) {
      return NextResponse.json(
        { error: 'None of the items in your cart are currently available.' },
        { status: 400 },
      )
    }

    // ── 2b. Apply customer discount if on file ───────────────────────────────
    const { data: customer } = await db
      .from('customers')
      .select('discount_percent')
      .eq('email', contact.email.trim().toLowerCase())
      .maybeSingle()
    const discountPct = customer?.discount_percent ? Number(customer.discount_percent) : 0
    if (discountPct > 0) {
      for (const li of lineItems) {
        li.line_total_cents = Math.round(li.line_total_cents * (1 - discountPct / 100))
      }
    }

    const subtotalCents = lineItems.reduce((sum, li) => sum + li.line_total_cents, 0)

    // ── 3. Enforce order minimum ─────────────────────────────────────────────
    const minErr = validateOrderMinimum(subtotalCents)
    if (minErr) {
      return NextResponse.json({ error: minErr.error }, { status: minErr.status })
    }

    // ── 4. Atomically insert order + items via RPC (Django atomic() pattern) ─
    // submit_order() wraps both inserts in a single PostgreSQL transaction —
    // no orphaned order_requests row if the items insert fails.
    let orderId: string | null = null
    let referenceCode = ''
    for (let attempt = 0; attempt < 3 && !orderId; attempt++) {
      referenceCode = await nextReferenceCode(db, attempt)
      const { data, error } = await db.rpc('submit_order', {
        p_reference_code:   referenceCode,
        p_customer_name:    contact.name.trim(),
        p_customer_email:   contact.email.trim().toLowerCase(),
        p_customer_phone:   contact.phone?.trim() || null,
        p_customer_company: contact.company?.trim() || null,
        p_notes:            contact.notes?.trim() || null,
        p_subtotal_cents:   subtotalCents,
        p_placed_by_rep:    contact.placedByRep?.trim() || null,
        p_po_number:        contact.poNumber?.trim() || null,
        p_items:            lineItems,
      })
      if (!error) {
        orderId = data as string
      } else if (error.code === '23505') {
        continue // duplicate reference_code — retry with next number
      } else {
        console.error('[orders] submit_order rpc failed:', error.message)
        return NextResponse.json({ error: 'Could not submit your request. Please try again.' }, { status: 500 })
      }
    }

    if (!orderId) {
      return NextResponse.json({ error: 'Could not generate an order reference. Please try again.' }, { status: 500 })
    }

    // ── 5. Side effects after commit (Django on_commit() pattern) ────────────
    // These run after the transaction has committed — never block the response
    // and never roll back the order on failure.
    void db
      .from('cart_sessions')
      .update({ order_placed_at: new Date().toISOString() })
      .eq('email', contact.email.trim())
      .is('order_placed_at', null)

    await Promise.allSettled([
      notifyReps({ referenceCode, contact, lineItems, subtotalCents, outOfStock, discountPct }),
      notifyCustomer({ referenceCode, contact, lineItems, subtotalCents }),
    ]).then((results) => {
      const labels = ['rep notification', 'customer confirmation']
      results.forEach((r, i) => {
        if (r.status === 'rejected') console.error(`[orders] ${labels[i]} failed (order still saved):`, r.reason)
      })
    })

    return NextResponse.json({ referenceCode, orderId })
  } catch (err) {
    console.error('[orders] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
