import type { SupabaseClient } from '@supabase/supabase-js'
import { isSmtpConfigured, sendMail } from './email'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, 'public', any>

export async function checkBackInStockAndNotify(db: DB): Promise<{ notified: number }> {
  if (!isSmtpConfigured()) return { notified: 0 }

  // Fetch all pending requests (notified_at is null)
  const { data: requests, error } = await db
    .from('back_in_stock_requests')
    .select('id, email, product_id, product:products(name, sku, stock_qty)')
    .is('notified_at', null)

  if (error) {
    console.error('[back-in-stock] fetch failed:', error.message)
    return { notified: 0 }
  }
  if (!requests?.length) return { notified: 0 }

  // Only notify for products that are now back in stock
  interface ProductSnap { name: string; sku: string; stock_qty: number }
  const toNotify = requests.filter((r) => {
    const raw = r.product
    const p = (Array.isArray(raw) ? raw[0] : raw) as ProductSnap | null
    return p && p.stock_qty > 0
  })
  if (!toNotify.length) return { notified: 0 }

  const now = new Date().toISOString()
  let notified = 0

  for (const req of toNotify) {
    const raw = req.product
    const p = (Array.isArray(raw) ? raw[0] : raw) as ProductSnap
    try {
      await sendMail({
        to: req.email,
        subject: `Back in stock: ${p.name}`,
        text:
          `Good news — ${p.name} (${p.sku}) is back in stock with ${p.stock_qty} units available.\n\n` +
          `Shop now: https://livecatalog.vercel.app/product/${req.product_id}\n\n` +
          `— L & Y USA\n`,
        from: process.env.REORDER_ALERT_FROM || process.env.TITAN_SMTP_USER,
      })
      await db
        .from('back_in_stock_requests')
        .update({ notified_at: now })
        .eq('id', req.id)
      notified++
    } catch (err) {
      console.error('[back-in-stock] failed to notify', req.email, err)
    }
  }

  console.log(`[back-in-stock] notified ${notified} subscriber(s)`)
  return { notified }
}
