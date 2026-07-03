/**
 * Low-stock reorder alerts.
 *
 * Fires one email when products drop to/below a global reorder threshold, and
 * de-dupes via the `low_stock_alerted` column so the same low-stock event
 * doesn't re-alert on every sync. A product can alert again once it's restocked
 * above the threshold and dips back down.
 *
 * Triggered from:
 *   - syncToSupabase() (manual Excel import + real Erply cron)
 *   - app/api/sync stub-skip branch (daily cron, even when Erply is unconfigured)
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { isEmailConfigured, sendMail } from './email'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, 'public', any>

export function getThreshold(): number {
  const n = parseInt(process.env.REORDER_THRESHOLD ?? '', 10)
  return Number.isFinite(n) && n >= 0 ? n : 5
}

export type LowStockResult =
  | { alerted: number; skipped?: undefined }
  | { skipped: string; alerted?: undefined }

export async function checkLowStockAndNotify(db: DB): Promise<LowStockResult> {
  if (!isEmailConfigured()) {
    console.log('[low-stock] email/recipient env not set — skipping alert check')
    return { skipped: 'email not configured' }
  }

  const threshold = getThreshold()
  const now = new Date().toISOString()

  // 1. Fetch all active products with their per-product or global threshold.
  //    We must evaluate per-product because each row may have its own threshold.
  const { data: allActive, error: fetchError } = await db
    .from('products')
    .select('sku, name, stock_qty, low_stock_threshold, low_stock_alerted')
    .eq('is_active', true)

  if (fetchError) {
    console.error('[low-stock] fetch query failed:', fetchError.message)
    return { skipped: 'query error' }
  }
  if (!allActive || allActive.length === 0) return { alerted: 0 }

  // 2. Reset: products restocked above their effective threshold become eligible to alert again.
  const restockedSkus = allActive
    .filter((p) => p.low_stock_alerted && p.stock_qty > (p.low_stock_threshold ?? threshold))
    .map((p) => p.sku)
  if (restockedSkus.length > 0) {
    await db
      .from('products')
      .update({ low_stock_alerted: false, updated_at: now })
      .in('sku', restockedSkus)
  }

  // 3. Find: at/below their effective threshold, not yet alerted.
  const low = allActive.filter((p) => {
    const effectiveThreshold = p.low_stock_threshold ?? threshold
    return !p.low_stock_alerted && p.stock_qty <= effectiveThreshold
  })

  if (low.length === 0) return { alerted: 0 }

  // 4. One email listing every newly low product.
  const lines = low
    .map((p) => {
      const effectiveThreshold = p.low_stock_threshold ?? threshold
      return `  ${p.sku} — ${p.name}: ${p.stock_qty} left (threshold: ${effectiveThreshold})`
    })
    .join('\n')
  const subject = `Low stock: ${low.length} product${low.length === 1 ? '' : 's'} at/below threshold`
  const text =
    `These products are at or below their reorder threshold:\n\n${lines}\n\n` +
    `Reorder as needed. (You won't be alerted again for these until they're restocked above their threshold and drop low again.)\n`

  await sendMail({ to: process.env.REORDER_ALERT_TO!, subject, text })

  // 5. Mark them alerted so they don't re-fire next sync.
  const skus = low.map((p) => p.sku)
  await db
    .from('products')
    .update({ low_stock_alerted: true, updated_at: now })
    .in('sku', skus)

  console.log(`[low-stock] alerted on ${low.length} product(s) at/below their threshold`)
  return { alerted: low.length }
}
