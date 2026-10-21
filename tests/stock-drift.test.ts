import { describe, expect, it } from 'vitest'
import { DRIFT_SAMPLE_SIZE, measureStockDrift, stockDriftFromDetails } from '../lib/stock-drift'
import { buildSyncRunRow } from '../lib/sync-runs'

const row = (sku: string, stock_qty: number | null, hidden = false) => ({ sku, stock_qty, is_active: true, manually_hidden: hidden })

describe('measureStockDrift', () => {
  it('counts counted Erply SKUs whose catalog stock differs, largest gap first', () => {
    // Real shapes from 2026-10-21: the oscillation (FD400039, K229486) and a
    // small 1,000 / 999 wobble.
    const drift = measureStockDrift(
      [
        { sku: 'FD400039', stockQty: 2800 },
        { sku: 'K229486', stockQty: 6000 },
        { sku: 'B325069', stockQty: 999 },
        { sku: 'OK1', stockQty: 50 },
      ],
      [row('FD400039', 4600, true), row('K229486', 12000), row('B325069', 1000), row('OK1', 50)],
    )
    expect(drift).toEqual({
      checked: 4,
      drifted: 3,
      driftedLive: 2,
      sample: [
        { sku: 'K229486', catalog: 12000, erply: 6000, live: true },
        { sku: 'FD400039', catalog: 4600, erply: 2800, live: false },
        { sku: 'B325069', catalog: 1000, erply: 999, live: true },
      ],
    })
  })

  // The stock sync skips Erply 0 on purpose ("not counted yet"), so the 999
  // import placeholders would otherwise read as 772 permanent false alarms.
  it('ignores Erply 0 and SKUs missing from either side', () => {
    const drift = measureStockDrift(
      [
        { sku: 'PLACEHOLDER', stockQty: 0 },
        { sku: 'NOT_IN_CATALOG', stockQty: 5 },
      ],
      [row('PLACEHOLDER', 999), row('NOT_IN_ERPLY', 999), { sku: null, stock_qty: 1, is_active: true, manually_hidden: false }],
    )
    expect(drift).toEqual({ checked: 0, drifted: 0, driftedLive: 0, sample: [] })
  })

  it('treats a null catalog stock as 0 and caps the sample', () => {
    const erply = Array.from({ length: 30 }, (_, i) => ({ sku: `S${i}`, stockQty: 10 + i }))
    const drift = measureStockDrift(erply, erply.map((e) => row(e.sku, null)))
    expect(drift.drifted).toBe(30)
    expect(drift.sample).toHaveLength(DRIFT_SAMPLE_SIZE)
    expect(drift.sample[0]).toMatchObject({ sku: 'S29', catalog: 0, erply: 39 })
  })
})

describe('stockDriftFromDetails', () => {
  it('reads back what the cron stores, without making the run partial', () => {
    const stockDrift = measureStockDrift([{ sku: 'A', stockQty: 5 }], [row('A', 7)])
    const run = buildSyncRunRow({ source: 'cron', startedAt: 0, result: { inserted: 0, updated: 1, deactivated: 0, errors: [] }, details: { stockDrift } })
    expect(run.status).toBe('ok')
    expect(stockDriftFromDetails(run.details)).toEqual(stockDrift)
  })

  it('is null for older runs, a skipped check, and malformed jsonb', () => {
    expect(stockDriftFromDetails(null)).toBeNull()
    expect(stockDriftFromDetails({ stockSync: { changed: 3 } })).toBeNull()
    expect(stockDriftFromDetails({ stockDrift: { skipped: 'check failed: timeout' } })).toBeNull()
    expect(stockDriftFromDetails({ stockDrift: { checked: 2, drifted: 1, sample: [{ sku: 'A' }, { sku: 'B', catalog: 1, erply: 2 }] } }))
      .toEqual({ checked: 2, drifted: 1, driftedLive: 0, sample: [{ sku: 'B', catalog: 1, erply: 2 }] })
  })

  // A failed check must not turn the night "partial": it has no `error` key.
  it('a failed check is recorded as skipped and leaves the run ok', () => {
    const run = buildSyncRunRow({
      source: 'cron',
      startedAt: 0,
      result: { inserted: 0, updated: 1, deactivated: 0, errors: [] },
      details: { stockDrift: { skipped: 'check failed: timeout' } },
    })
    expect(run.status).toBe('ok')
  })
})
