/**
 * Stock drift: after the nightly stock sync, how many catalog products still
 * disagree with Erply?
 *
 * Exists because the sync's own bug went unnoticed for a month: anchored at
 * each run's start, it applied every Erply change twice and reversed it
 * twice on a 6-night cycle (docs/memory/project-stock-sync-oscillation-
 * 20261021.md). Every run reported "ok"; only a manual
 * scripts/audit-stock-vs-erply.ts showed the catalog swinging. This runs the
 * same comparison every night, from the Erply stock the cron already
 * fetched, and records it in sync_runs.details.stockDrift for /admin/sync.
 *
 * Read-only. Only SKUs Erply has COUNTED (stock > 0) are compared: the stock
 * sync deliberately skips Erply 0 ("not counted yet", decided 2026-09-03), so
 * those disagree by design -- e.g. the 999 import placeholders.
 *
 * Right after a working sync, a counted SKU matches Erply unless the catalog
 * changed since the previous run (an order decrement Erply hasn't seen yet),
 * so the expected count is small. A large one, or the same SKUs flipping
 * sign night to night, means the sync is wrong again.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { selectAll } from './product-sync'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any, 'public', any>

export const DRIFT_SAMPLE_SIZE = 20

export interface StockDriftRow {
  sku: string
  catalog: number
  erply: number
  live: boolean
}

export interface StockDrift {
  /** Counted Erply SKUs that exist in the catalog. */
  checked: number
  drifted: number
  /** Of the drifted, how many customers can see. */
  driftedLive: number
  /** Largest gaps first. */
  sample: StockDriftRow[]
}

interface CatalogStockRow {
  sku: string | null
  stock_qty: number | null
  is_active: boolean
  manually_hidden: boolean | null
}

/** Pure: compare Erply's counted stock against the catalog. */
export function measureStockDrift(
  erplyStock: { sku: string; stockQty: number }[],
  catalog: CatalogStockRow[],
): StockDrift {
  const bySku = new Map(catalog.filter((c) => c.sku).map((c) => [c.sku!, c]))
  let checked = 0
  const drifted: StockDriftRow[] = []
  for (const e of erplyStock) {
    if (e.stockQty === 0) continue
    const c = bySku.get(e.sku)
    if (!c) continue
    checked++
    const catalogQty = c.stock_qty ?? 0
    if (catalogQty !== e.stockQty) {
      drifted.push({ sku: e.sku, catalog: catalogQty, erply: e.stockQty, live: c.is_active && !c.manually_hidden })
    }
  }
  drifted.sort((a, b) => Math.abs(b.catalog - b.erply) - Math.abs(a.catalog - a.erply) || a.sku.localeCompare(b.sku))
  return {
    checked,
    drifted: drifted.length,
    driftedLive: drifted.filter((d) => d.live).length,
    sample: drifted.slice(0, DRIFT_SAMPLE_SIZE),
  }
}

/** Reads the catalog's stock and measures drift against `erplyStock`. */
export async function checkStockDrift(erplyStock: { sku: string; stockQty: number }[], db: DB): Promise<StockDrift> {
  const catalog = await selectAll<CatalogStockRow>((from, to) =>
    db.from('products').select('sku, stock_qty, is_active, manually_hidden').order('id').range(from, to),
  )
  return measureStockDrift(erplyStock, catalog)
}

/**
 * Pure: read a stored drift back out of a run's details. details is jsonb, so
 * anything malformed reads as none rather than breaking /admin/sync.
 */
export function stockDriftFromDetails(details: Record<string, unknown> | null): StockDrift | null {
  const d = details?.stockDrift as Partial<StockDrift> | undefined
  if (!d || typeof d.checked !== 'number' || typeof d.drifted !== 'number' || !Array.isArray(d.sample)) return null
  const sample = d.sample.filter(
    (s): s is StockDriftRow =>
      !!s && typeof s === 'object' && typeof s.sku === 'string' && typeof s.catalog === 'number' && typeof s.erply === 'number',
  )
  return { checked: d.checked, drifted: d.drifted, driftedLive: typeof d.driftedLive === 'number' ? d.driftedLive : 0, sample }
}
