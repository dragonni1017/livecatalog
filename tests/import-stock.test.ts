import { describe, expect, it } from 'vitest'
import { applyStockGuard, stockGuardNote, stockManagedByErply, type ErplyStockGuard } from '../lib/import-stock'

const guard: ErplyStockGuard = { counted: new Set(['F286644', 'P273810-60CM']) }
const row = (sku: string, stock_qty: number | null) => ({ sku, name: sku, stock_qty })

describe('applyStockGuard', () => {
  // The double count of 2026-10-22: a sheet sets stock, Erply receives the
  // same delivery, and the nightly sync adds Erply's change on top.
  it("drops the sheet's stock for SKUs Erply counts and keeps the rest", () => {
    const { rows, ignored } = applyStockGuard(
      [row('F286644', 1500), row('p273810-60cm', 40), row('NEVER_COUNTED', 999), row('F286644-BLANK', null)],
      guard,
    )
    expect(rows.map((r) => r.stock_qty)).toEqual([null, null, 999, null])
    expect(ignored).toEqual(['F286644', 'p273810-60cm'])
  })

  it('leaves a blank Stock Qty out of the ignored list', () => {
    expect(applyStockGuard([row('F286644', null)], guard).ignored).toEqual([])
  })

  // Failing open would bring the double count back exactly when nobody can
  // see it.
  it("ignores every Stock Qty when Erply couldn't be read", () => {
    const failed: ErplyStockGuard = { failed: 'timeout' }
    const { rows, ignored } = applyStockGuard([row('NEVER_COUNTED', 999), row('X', null)], failed)
    expect(rows.map((r) => r.stock_qty)).toEqual([null, null])
    expect(ignored).toEqual(['NEVER_COUNTED'])
    expect(stockManagedByErply('ANYTHING', failed)).toBe(true)
  })

  it('changes nothing when Erply is not configured (local dev)', () => {
    const rows = [row('F286644', 1500)]
    expect(applyStockGuard(rows, null)).toEqual({ rows, ignored: [] })
  })
})

describe('stockGuardNote', () => {
  it('says why, or nothing when nothing was ignored', () => {
    expect(stockGuardNote(guard, 0)).toBeNull()
    expect(stockGuardNote(null, 3)).toBeNull()
    expect(stockGuardNote(guard, 2)).toMatch(/^2 Stock Qty values ignored: Erply manages/)
    expect(stockGuardNote({ failed: 'timeout' }, 1)).toMatch(/^1 Stock Qty value ignored: couldn't check Erply \(timeout\)/)
  })
})
