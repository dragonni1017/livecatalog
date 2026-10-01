import { getAdminClient } from '@/lib/supabase'
import { isSmtpConfigured, sendMail } from '@/lib/email'
import { sanitizeGreetingName } from '@/lib/cart-session-items'

export async function checkAbandonedCarts(db: ReturnType<typeof getAdminClient>) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { data } = await db
    .from('cart_sessions')
    .select('id, email, name, items')
    .is('order_placed_at', null)
    .is('reminder_sent_at', null)
    .lt('updated_at', cutoff)
    .limit(50)

  if (!data?.length) return

  // Every line is rebuilt from products at send time, never from the stored
  // text. /api/cart-session now stores only DB-derived items, but rows saved
  // before 2026-10-01 may hold whatever a caller sent. See
  // lib/cart-session-items.ts. Only products a shopper could see are listed.
  const skus = [
    ...new Set(
      data.flatMap((s) =>
        Array.isArray(s.items) ? (s.items as { sku?: unknown }[]).map((i) => i?.sku).filter((x): x is string => typeof x === 'string') : [],
      ),
    ),
  ]
  const { data: products } = skus.length
    ? await db.from('products').select('sku, name').in('sku', skus).eq('is_active', true).eq('manually_hidden', false)
    : { data: [] as { sku: string; name: string }[] }
  const nameBySku = new Map((products ?? []).map((p) => [p.sku as string, p.name as string]))

  for (const session of data) {
    try {
      const stored = Array.isArray(session.items) ? (session.items as { sku?: unknown; qty?: unknown }[]) : []
      // Prices are left out on purpose: a stored or base price can differ from
      // the tier price the customer saw, and a rep confirms pricing anyway.
      const itemLines = stored
        .flatMap((i) => {
          const name = typeof i?.sku === 'string' ? nameBySku.get(i.sku) : undefined
          const qty = typeof i?.qty === 'number' && Number.isInteger(i.qty) && i.qty > 0 ? i.qty : null
          return name && qty ? [`  • ${name} (${i.sku}) × ${qty}`] : []
        })
        .join('\n')

      // Nothing left that we'd vouch for: mark it handled and send nothing.
      if (itemLines && isSmtpConfigured()) {
        const greetingName = sanitizeGreetingName(session.name)
        await sendMail({
          to: session.email,
          subject: 'You left something behind — L & Y USA',
          text:
            `Hi${greetingName ? ` ${greetingName}` : ''},\n\n` +
            `It looks like you started an order with us but didn't finish. Your items are still waiting:\n\n` +
            `${itemLines}\n\n` +
            `Ready to complete your order?\nhttps://lyusa.app\n\n` +
            `If you have any questions, reply to this email.\n\n` +
            `— L & Y USA`,
          from: process.env.SALES_ALERT_FROM || process.env.TITAN_SMTP_USER,
          replyTo: process.env.SALES_ALERT_TO,
        })
      }

      await db
        .from('cart_sessions')
        .update({ reminder_sent_at: new Date().toISOString() })
        .eq('id', session.id)
    } catch (err) {
      console.error('[abandoned-cart] failed for', session.email, err)
    }
  }
}
