import { isSmtpConfigured, sendMail } from '@/lib/email'
import { formatPriceCents } from '@/lib/order-rules'
import type { CheckoutContact } from '@/lib/types'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Combines the manually-typed "CC sales rep" field with whichever rep was
// picked from the "Placed by (rep)" dropdown, so a rep is automatically on
// the email chain for any order attributed to them — not just when someone
// remembers to also fill in the separate CC field. Dedupes and validates
// both as email addresses (placedByRep is a dropdown of real rep accounts
// today, but this stays defensive against a malformed direct API call).
function buildRepCcList(contact: CheckoutContact): string | undefined {
  const candidates = [contact.ccEmail, contact.placedByRep]
    .map((v) => v?.trim().toLowerCase())
    .filter((v): v is string => !!v && EMAIL_RE.test(v))
  const unique = [...new Set(candidates)]
  return unique.length > 0 ? unique.join(', ') : undefined
}

type LineItem = {
  sku: string
  name: string
  unit_price_cents: number
  qty: number
  line_total_cents: number
}

export async function notifyReps(args: {
  referenceCode: string
  contact: CheckoutContact
  lineItems: LineItem[]
  subtotalCents: number
  outOfStock: string[]
  discountPct?: number
}): Promise<void> {
  const to = process.env.SALES_ALERT_TO
  if (!isSmtpConfigured() || !to) {
    console.log('[orders] SMTP / SALES_ALERT_TO not set — skipping rep notification')
    return
  }

  const { referenceCode, contact, lineItems, subtotalCents, outOfStock, discountPct } = args
  const who = contact.company?.trim() || contact.name.trim()
  const subject = `New order request ${referenceCode} — ${who} (${formatPriceCents(subtotalCents)})`

  const cc = buildRepCcList(contact)

  const itemLines = lineItems
    .map((li) => `  ${li.qty} × ${li.sku} — ${li.name} @ ${formatPriceCents(li.unit_price_cents)} = ${formatPriceCents(li.line_total_cents)}`)
    .join('\n')

  const text =
    `New order request: ${referenceCode}\n\n` +
    `Customer\n` +
    `  Name:    ${contact.name.trim()}\n` +
    `  Email:   ${contact.email.trim()}\n` +
    `  Phone:   ${contact.phone?.trim() || '—'}\n` +
    `  Company: ${contact.company?.trim() || '—'}\n` +
    `  Rep:     ${contact.placedByRep?.trim() || '—'}\n` +
    `  PO #:    ${contact.poNumber?.trim() || '—'}\n` +
    `  CC:      ${cc || '—'}\n\n` +
    `Items\n${itemLines}\n\n` +
    `Subtotal: ${formatPriceCents(subtotalCents)}` +
    (discountPct ? ` (${discountPct}% customer discount applied)` : '') +
    `\n\n` +
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
    cc,
  })
}

export async function notifyOrderStatusChange(args: {
  orderId: string
  status: 'contacted' | 'converted' | 'lost'
  db: Awaited<ReturnType<typeof import('@/lib/supabase').getAdminClient>>
}): Promise<void> {
  if (!isSmtpConfigured()) return

  const { orderId, status, db } = args
  const { data: order } = await db
    .from('order_requests')
    .select('customer_name, customer_email, reference_code')
    .eq('id', orderId)
    .single()

  if (!order) return

  const prodUrl = 'https://livecatalog.vercel.app'
  const trackUrl = `${prodUrl}/order/${order.reference_code}`
  const replyTo = process.env.SALES_ALERT_TO
  const from = process.env.SALES_ALERT_FROM || process.env.TITAN_SMTP_USER

  let subject: string
  let text: string

  if (status === 'contacted') {
    subject = `Update on your order ${order.reference_code}`
    text = `Hi ${order.customer_name},\n\nWe've reviewed your order request and a member of our team will be in touch with you shortly to confirm availability and next steps.\n\nYour reference: ${order.reference_code}\nTrack your order: ${trackUrl}\n\nIf you have any questions in the meantime, just reply to this email.\n\n— L & Y USA`
  } else if (status === 'converted') {
    subject = `Your order ${order.reference_code} is confirmed`
    text = `Hi ${order.customer_name},\n\nGreat news — your order has been confirmed and is being processed by our team.\n\nYour reference: ${order.reference_code}\nTrack your order: ${trackUrl}\n\nIf you have any questions, just reply to this email.\n\n— L & Y USA`
  } else {
    subject = `Regarding your order request ${order.reference_code}`
    text = `Hi ${order.customer_name},\n\nThank you for your interest. Unfortunately, we're unable to fulfill order request ${order.reference_code} at this time — this may be due to availability, minimum quantities, or other factors.\n\nIf you'd like to discuss alternatives or place a new request, please reply to this email and we'll be happy to help.\n\n— L & Y USA`
  }

  try {
    await sendMail({ to: order.customer_email, subject, text, replyTo, from })
  } catch (mailErr) {
    console.error('[admin/orders PATCH] customer email failed:', mailErr)
  }
}

export async function notifyCustomer(args: {
  referenceCode: string
  contact: CheckoutContact
  lineItems: LineItem[]
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
    .map((li) => `  ${li.qty} × ${li.name} (${li.sku}) @ ${formatPriceCents(li.unit_price_cents)} = ${formatPriceCents(li.line_total_cents)}`)
    .join('\n')

  const text =
    `Hi ${contact.name.trim()},\n\n` +
    `Thanks for your request — we've received it and a member of our team will be in touch shortly to confirm availability and next steps.\n\n` +
    `Your reference: ${referenceCode}\n\n` +
    `Items requested\n${itemLines}\n\n` +
    `Subtotal: ${formatPriceCents(subtotalCents)}\n\n` +
    `Track your order status: https://livecatalog.vercel.app/order/${referenceCode}\n\n` +
    `This is a request, not a finalized order — pricing and availability are confirmed by our team before anything is charged.\n\n` +
    `If you have any questions, just reply to this email.\n\n` +
    `— L & Y USA\n`

  await sendMail({
    to,
    subject,
    text,
    replyTo: process.env.SALES_ALERT_TO || undefined,
    from: process.env.SALES_ALERT_FROM || undefined,
    // Puts the rep on the actual customer-facing thread (not just the
    // internal alert) so they see any reply the customer sends here too.
    cc: buildRepCcList(contact),
  })
}
