import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { getSessionUser } from '@/lib/auth-server'
import { validateOrderInput, validateOrderMinimum } from '@/lib/order-validation'
import { notifyReps, notifyCustomer } from '@/lib/order-emails'
import { applyTierDiscount } from '@/lib/order-rules'
import { buildLineItems, insertOrder } from '@/lib/order-submission'
import { TIER_COOKIE } from '@/lib/rep-tier-shared'

export const dynamic = 'force-dynamic'

function isMockMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return !url || url === 'your-supabase-url' || url.includes('placeholder')
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
    const built = await buildLineItems(db, items)
    if ('error' in built) {
      return NextResponse.json({ error: built.error }, { status: 500 })
    }
    const { lineItems, outOfStock } = built

    if (lineItems.length === 0) {
      return NextResponse.json(
        { error: 'None of the items in your cart are currently available.' },
        { status: 400 },
      )
    }

    // ── 2b. Apply pricing: a real rep's selected tier overrides any customer
    // file discount for this order (never stacked) — mirrors the header
    // TierSwitcher's display-only cookie, but re-verified here against the
    // actual session and price_tiers table, never trusted from the client.
    let discountPct = 0
    let repUserId: string | null = null
    let appliedTierCode: string | null = null

    const sessionUser = await getSessionUser()
    const isRep = sessionUser?.app_metadata?.role === 'rep'
    if (isRep) {
      const tierCode = request.cookies.get(TIER_COOKIE)?.value
      if (tierCode) {
        const { data: tier } = await db
          .from('price_tiers')
          .select('code, discount_percent, active')
          .eq('code', tierCode)
          .maybeSingle()
        if (tier?.active) {
          discountPct = Number(tier.discount_percent)
          repUserId = sessionUser!.id
          appliedTierCode = tier.code
          // Attribution comes from the verified session, not client input.
          contact.placedByRep = sessionUser!.email ?? contact.placedByRep
        }
      }
    }

    // ── 2c. A customer directly assigned a price tier (app/admin/customers)
    // gets that tier's pricing automatically, no rep or login required —
    // resolved by the order's own email, same as the flat discount_percent
    // fallback below. The tier wins over the flat discount when both are
    // set (never stacked), same override rule as the rep-tier case above.
    if (!appliedTierCode) {
      const { data: customer } = await db
        .from('customers')
        .select('discount_percent, price_tier_code')
        .eq('email', contact.email.trim().toLowerCase())
        .maybeSingle()

      if (customer?.price_tier_code) {
        const { data: tier } = await db
          .from('price_tiers')
          .select('code, discount_percent, active')
          .eq('code', customer.price_tier_code)
          .maybeSingle()
        if (tier?.active) {
          discountPct = Number(tier.discount_percent)
          appliedTierCode = tier.code
        }
      }

      if (!appliedTierCode) {
        discountPct = customer?.discount_percent ? Number(customer.discount_percent) : 0
      }
    }

    // Rep-only per-line price override ("Custom price for this order" on
    // AddToCartButton) -- re-verified against isRep here, never trusted from
    // the client. An overridden line becomes its own final price and is
    // excluded from the tier-discount loop below (the discount doesn't
    // stack on top of a price the rep already set directly).
    const overriddenProductIds = new Set<string>()
    if (isRep) {
      for (const item of items) {
        const override = item.unitPriceOverrideCents
        if (typeof override !== 'number') continue
        const li = lineItems.find((l) => l.product_id === item.productId)
        if (!li) continue
        li.unit_price_cents = override
        li.line_total_cents = override * li.qty
        overriddenProductIds.add(li.product_id)
      }
    }

    if (discountPct > 0) {
      for (const li of lineItems) {
        if (overriddenProductIds.has(li.product_id)) continue
        li.line_total_cents = applyTierDiscount(li.line_total_cents, discountPct)
      }
    }

    const subtotalCents = lineItems.reduce((sum, li) => sum + li.line_total_cents, 0)

    // ── 3. Enforce order minimum ─────────────────────────────────────────────
    const minErr = validateOrderMinimum(subtotalCents)
    if (minErr) {
      return NextResponse.json({ error: minErr.error }, { status: minErr.status })
    }

    // ── 4. Atomically insert order + items via RPC (Django atomic() pattern) ─
    const inserted = await insertOrder({
      db,
      contact,
      lineItems,
      subtotalCents,
      repUserId,
      appliedTierCode,
      appliedTierDiscountPercent: appliedTierCode ? discountPct : null,
    })
    if (!inserted.ok) {
      return NextResponse.json({ error: inserted.error }, { status: inserted.status })
    }
    const { orderId, referenceCode } = inserted

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
