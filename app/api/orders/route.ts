import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { isSmtpConfigured, sendMail } from '@/lib/email'
import type { CheckoutContact } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface IncomingItem {
  productId: string
  qty: number
}

function isMockMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return !url || url === 'your-supabase-url' || url.includes('placeholder')
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

// ORD-<year>-<4-digit sequence>. Sequence derived from this year's order count.
// The reference_code unique constraint guards against a concurrent collision;
// the caller retries with the next number if an insert is rejected.
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
    const items: IncomingItem[] = Array.isArray(body.items) ? body.items : []
    const contact: CheckoutContact = body.contact ?? {}

    // ── Validate ────────────────────────────────────────────────────────────
    if (!contact.name?.trim() || !contact.email?.trim()) {
      return NextResponse.json({ error: 'Name and email are required.' }, { status: 400 })
    }
    const cleanItems = items.filter((i) => i?.productId && Number.isFinite(i.qty) && i.qty > 0)
    if (cleanItems.length === 0) {
      return NextResponse.json({ error: 'Your cart is empty.' }, { status: 400 })
    }

    // ── Mock mode: no Supabase wired up locally — return a fake reference ─────
    if (isMockMode()) {
      return NextResponse.json({ referenceCode: 'ORD-MOCK-0001', orderId: 'mock' })
    }

    const db = getAdminClient()

    // ── Re-fetch authoritative product data server-side (never trust client) ──
    const ids = cleanItems.map((i) => i.productId)
    const { data: products, error: prodErr } = await db
      .from('products')
      .select('id, sku, name, price_cents, stock_qty, is_active, manually_hidden')
      .in('id', ids)

    if (prodErr) {
      console.error('[orders] product lookup failed:', prodErr.message)
      return NextResponse.json({ error: 'Could not validate cart. Please try again.' }, { status: 500 })
    }

    const byId = new Map((products ?? []).map((p) => [p.id, p]))
    const lineItems: {
      product_id: string
      sku: string
      name: string
      unit_price_cents: number
      qty: number
      line_total_cents: number
    }[] = []
    const outOfStock: string[] = []

    for (const item of cleanItems) {
      const p = byId.get(item.productId)
      // Skip anything not currently orderable (deleted, inactive, or hidden).
      if (!p || !p.is_active || p.manually_hidden) continue
      if (p.stock_qty < item.qty) outOfStock.push(`${p.sku} (${p.name}) — ${p.stock_qty} in stock, ${item.qty} requested`)
      lineItems.push({
        product_id: p.id,
        sku: p.sku,
        name: p.name,
        unit_price_cents: p.price_cents,
        qty: item.qty,
        line_total_cents: p.price_cents * item.qty,
      })
    }

    if (lineItems.length === 0) {
      return NextResponse.json(
        { error: 'None of the items in your cart are currently available.' },
        { status: 400 },
      )
    }

    const subtotalCents = lineItems.reduce((sum, li) => sum + li.line_total_cents, 0)

    // ── Insert order + items (retry reference code on unique collision) ───────
    let orderId: string | null = null
    let referenceCode = ''
    for (let attempt = 0; attempt < 3 && !orderId; attempt++) {
      referenceCode = await nextReferenceCode(db, attempt)
      const { data, error } = await db
        .from('order_requests')
        .insert({
          reference_code: referenceCode,
          status: 'new',
          customer_name: contact.name.trim(),
          customer_email: contact.email.trim(),
          customer_phone: contact.phone?.trim() || null,
          customer_company: contact.company?.trim() || null,
          notes: contact.notes?.trim() || null,
          subtotal_cents: subtotalCents,
        })
        .select('id')
        .single()
      if (!error) {
        orderId = data.id
      } else if (error.code === '23505') {
        continue // duplicate reference_code — retry with next number
      } else {
        console.error('[orders] insert order_requests failed:', error.message)
        return NextResponse.json({ error: 'Could not submit your request. Please try again.' }, { status: 500 })
      }
    }

    if (!orderId) {
      return NextResponse.json({ error: 'Could not generate an order reference. Please try again.' }, { status: 500 })
    }

    const { error: itemsErr } = await db
      .from('order_items')
      .insert(lineItems.map((li) => ({ ...li, order_id: orderId })))
    if (itemsErr) {
      console.error('[orders] insert order_items failed:', itemsErr.message)
      // Roll back the parent so we don't leave an order with no items.
      await db.from('order_requests').delete().eq('id', orderId)
      return NextResponse.json({ error: 'Could not submit your request. Please try again.' }, { status: 500 })
    }

    // ── Notify sales reps + confirm to customer — best-effort, never fails the order ──
    await Promise.allSettled([
      notifyReps({ referenceCode, contact, lineItems, subtotalCents, outOfStock }),
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

async function notifyReps(args: {
  referenceCode: string
  contact: CheckoutContact
  lineItems: { sku: string; name: string; unit_price_cents: number; qty: number; line_total_cents: number }[]
  subtotalCents: number
  outOfStock: string[]
}): Promise<void> {
  const to = process.env.SALES_ALERT_TO
  if (!isSmtpConfigured() || !to) {
    console.log('[orders] SMTP / SALES_ALERT_TO not set — skipping rep notification')
    return
  }

  const { referenceCode, contact, lineItems, subtotalCents, outOfStock } = args
  const who = contact.company?.trim() || contact.name.trim()
  const subject = `New order request ${referenceCode} — ${who} (${formatPrice(subtotalCents)})`

  const itemLines = lineItems
    .map((li) => `  ${li.qty} × ${li.sku} — ${li.name} @ ${formatPrice(li.unit_price_cents)} = ${formatPrice(li.line_total_cents)}`)
    .join('\n')

  const text =
    `New order request: ${referenceCode}\n\n` +
    `Customer\n` +
    `  Name:    ${contact.name.trim()}\n` +
    `  Email:   ${contact.email.trim()}\n` +
    `  Phone:   ${contact.phone?.trim() || '—'}\n` +
    `  Company: ${contact.company?.trim() || '—'}\n\n` +
    `Items\n${itemLines}\n\n` +
    `Subtotal: ${formatPrice(subtotalCents)}\n\n` +
    (contact.notes?.trim() ? `Notes\n  ${contact.notes.trim()}\n\n` : '') +
    (outOfStock.length
      ? `⚠️ Stock warnings (confirm availability before quoting):\n${outOfStock.map((s) => `  ${s}`).join('\n')}\n\n`
      : '') +
    `Reply to this email to reach the customer directly.\n`

  await sendMail({
    to,
    subject,
    text,
    replyTo: contact.email.trim(),
    from: process.env.SALES_ALERT_FROM || undefined,
  })
}

// Confirmation to the customer who placed the request. Best-effort — guarded the
// same way as the rep notification, so a missing SMTP config just skips it. Sent
// FROM the sales mailbox with Reply-To pointed at SALES_ALERT_TO, so if the
// customer replies they reach the team rather than the no-reply automation.
async function notifyCustomer(args: {
  referenceCode: string
  contact: CheckoutContact
  lineItems: { sku: string; name: string; unit_price_cents: number; qty: number; line_total_cents: number }[]
  subtotalCents: number
}): Promise<void> {
  if (!isSmtpConfigured()) {
    console.log('[orders] SMTP not set — skipping customer confirmation')
    return
  }

  const { referenceCode, contact, lineItems, subtotalCents } = args
  const to = contact.email.trim()
  const subject = `We received your order request — ${referenceCode}`

  const itemLines = lineItems
    .map((li) => `  ${li.qty} × ${li.name} (${li.sku}) @ ${formatPrice(li.unit_price_cents)} = ${formatPrice(li.line_total_cents)}`)
    .join('\n')

  const text =
    `Hi ${contact.name.trim()},\n\n` +
    `Thanks for your request — we've received it and a member of our team will be in touch shortly to confirm availability and next steps.\n\n` +
    `Your reference: ${referenceCode}\n\n` +
    `Items requested\n${itemLines}\n\n` +
    `Subtotal: ${formatPrice(subtotalCents)}\n\n` +
    `This is a request, not a finalized order — pricing and availability are confirmed by our team before anything is charged.\n\n` +
    `If you have any questions, just reply to this email.\n\n` +
    `— L & Y USA\n`

  await sendMail({
    to,
    subject,
    text,
    replyTo: process.env.SALES_ALERT_TO || undefined,
    from: process.env.SALES_ALERT_FROM || undefined,
  })
}
