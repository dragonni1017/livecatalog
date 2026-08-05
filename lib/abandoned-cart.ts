import { getAdminClient } from '@/lib/supabase'
import { isSmtpConfigured, sendMail } from '@/lib/email'

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

  for (const session of data) {
    try {
      const items = session.items as { sku: string; name: string; qty: number; priceCents: number }[]
      const itemLines = items
        .map((i) => `  • ${i.name} (${i.sku}) × ${i.qty} — $${(i.priceCents / 100).toFixed(2)}`)
        .join('\n')

      if (isSmtpConfigured()) {
        await sendMail({
          to: session.email,
          subject: 'You left something behind — L & Y USA',
          text:
            `Hi${session.name ? ` ${session.name}` : ''},\n\n` +
            `It looks like you started an order with us but didn't finish. Your items are still waiting:\n\n` +
            `${itemLines}\n\n` +
            `Ready to complete your order?\nhttps://livecatalog.vercel.app\n\n` +
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
