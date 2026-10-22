/**
 * Which Stock Qty cells an /admin/import sheet may write.
 *
 * The import REPLACES stock_qty, while the nightly Erply stock sync ADDS each
 * night's Erply change on top of whatever the catalog holds (delta-anchored,
 * lib/product-sync.ts syncStockFromErply). So for a SKU Erply counts, a
 * sheet carrying the same delivery Erply also received counts it twice: import
 * 1,000 -> 1,500, Erply 1,000 -> 1,500, and that night the catalog reads
 * 2,000. Erply is the stock master, so a sheet's Stock Qty for those SKUs is
 * ignored (decided 2026-10-22). Only SKUs Erply has never counted take their
 * stock from the sheet; the sync leaves those alone.
 *
 * If Erply can't be read, every Stock Qty is ignored: failing open would
 * bring the double count back exactly when nobody can see it.
 */

/** Upper-cased SKUs Erply counts, or why that couldn't be read. */
export type ErplyStockGuard = { counted: Set<string> } | { failed: string }

/** Pure: does this SKU's Stock Qty cell get ignored? */
export function stockManagedByErply(sku: string, guard: ErplyStockGuard | null): boolean {
  if (!guard) return false
  if ('failed' in guard) return true
  return guard.counted.has(sku.trim().toUpperCase())
}

/**
 * Pure: blank the stock of every row whose stock Erply manages. A blank stock
 * means "keep what's stored" to the import (keepExistingWhenBlank), and 0 on
 * a brand-new product, which the next stock sync then takes to Erply's count.
 * Returns the SKUs whose non-blank Stock Qty was dropped.
 */
export function applyStockGuard<T extends { sku: string; stock_qty: number | null }>(
  rows: T[],
  guard: ErplyStockGuard | null,
): { rows: T[]; ignored: string[] } {
  const ignored: string[] = []
  const out = rows.map((r) => {
    if (r.stock_qty === null || !stockManagedByErply(r.sku, guard)) return r
    ignored.push(r.sku)
    return { ...r, stock_qty: null }
  })
  return { rows: out, ignored }
}

/** Human-readable reason, for the preview and the result. */
export function stockGuardNote(guard: ErplyStockGuard | null, ignoredCount: number): string | null {
  if (!guard || ignoredCount === 0) return null
  const n = `${ignoredCount.toLocaleString()} Stock Qty value${ignoredCount === 1 ? '' : 's'}`
  if ('failed' in guard) {
    return `${n} ignored: couldn't check Erply (${guard.failed}), so no stock was changed. Try again later.`
  }
  return `${n} ignored: Erply manages these products' stock and the nightly sync keeps it current. Update them in Erply.`
}

/**
 * Reads which SKUs Erply counts, at warehouse 1 like the stock sync. Null
 * when Erply isn't configured (local dev): there is no sync to collide with.
 */
export async function loadErplyStockGuard(): Promise<ErplyStockGuard | null> {
  const { getErplyStock, isConfigured } = await import('./erply')
  if (!isConfigured()) return null
  try {
    const stock = await getErplyStock(1)
    if (stock.length === 0) return { failed: 'Erply returned no products' }
    return { counted: new Set(stock.filter((s) => s.counted).map((s) => s.sku.toUpperCase())) }
  } catch (err) {
    return { failed: err instanceof Error ? err.message : String(err) }
  }
}
