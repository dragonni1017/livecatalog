import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { syncStockFromErply } from '../lib/product-sync'

/**
 * In-memory model of what syncStockFromErply touches: products.stock_qty,
 * stock_adjustments (timestamped by the DATABASE clock, optionally skewed
 * from ours), erply_sync_state, and the two RPCs with migration 0042's
 * semantics -- stock_qty_as_of_bulk returns the new_qty of the latest
 * adjustment at or before p_as_of, else the current stock_qty.
 */
function simDb(initial: Record<string, number>, { dbClockSkewMs = 0 } = {}) {
  const stock = new Map(Object.entries(initial))
  const adjustments: { sku: string; delta: number; new_qty: number; created_at: string }[] = []
  let lastSync: string | null = null
  const dbNow = () => new Date(Date.now() + dbClockSkewMs).toISOString()

  const adjust = (sku: string, delta: number) => {
    // Each write takes a moment, as a real round trip does.
    vi.setSystemTime(Date.now() + 5)
    const next = (stock.get(sku) ?? 0) + delta
    stock.set(sku, next)
    adjustments.push({ sku, delta, new_qty: next, created_at: dbNow() })
  }

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    if (fn === 'adjust_stock') {
      adjust(args.p_sku as string, args.p_delta as number)
      return { data: null, error: null }
    }
    if (fn === 'stock_qty_as_of_bulk') {
      const asOf = Date.parse(args.p_as_of as string)
      const rows = (args.p_skus as string[])
        .filter((sku) => stock.has(sku))
        .map((sku) => {
          const before = adjustments.filter((a) => a.sku === sku && Date.parse(a.created_at) <= asOf)
          return { sku, qty: before.length ? before[before.length - 1].new_qty : stock.get(sku)! }
        })
      return { data: rows, error: null }
    }
    throw new Error(`unexpected rpc ${fn}`)
  }

  const from = (table: string) => {
    const calls: [string, unknown[]][] = []
    const resolve = () => {
      const update = calls.find(([m]) => m === 'update')
      if (table === 'erply_sync_state') {
        if (update) {
          lastSync = (update[1][0] as { last_stock_sync_at: string }).last_stock_sync_at
          return { data: null, error: null }
        }
        return { data: { last_stock_sync_at: lastSync }, error: null }
      }
      if (table === 'stock_adjustments') {
        const newest = [...adjustments].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0]
        return { data: newest ? { created_at: newest.created_at } : null, error: null }
      }
      throw new Error(`unexpected table ${table}`)
    }
    const builder: unknown = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') {
            return (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => Promise.resolve(resolve()).then(ok, bad)
          }
          return (...a: unknown[]) => {
            calls.push([String(prop), a])
            return builder
          }
        },
      },
    )
    return builder
  }

  // Real products all carry an earlier adjustment (the first sync on
  // 2026-09-04). It matters: with no history, stock_qty_as_of_bulk falls back
  // to the CURRENT stock and hides the start-anchoring bug entirely.
  vi.setSystemTime(Date.parse('2026-09-04T08:33:00Z'))
  for (const sku of stock.keys()) adjust(sku, 0)
  lastSync = new Date(Date.now() + 1_000).toISOString()

  return { db: { from, rpc } as never, stock, adjustments, orderDecrement: (sku: string, n: number) => adjust(sku, -n) }
}

const DAY = 86_400_000
let night = 0
const runNight = async (db: never, erply: Record<string, number>) => {
  night++
  vi.setSystemTime(Date.parse('2026-10-01T08:33:00Z') + night * DAY)
  return syncStockFromErply(Object.entries(erply).map(([sku, stockQty]) => ({ sku, stockQty })), db)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  night = 0
})
afterEach(() => vi.useRealTimers())

describe('syncStockFromErply anchoring', () => {
  // The bug of 2026-10-21: anchored at the run's START, every Erply change
  // was applied twice and reversed twice, on a 6-night cycle. FD400039 at a
  // steady 2,800 in Erply read 1,000 / 2,800 / 4,600 in the catalog.
  it('converges on a steady Erply value and then stops moving', async () => {
    const sim = simDb({ FD400039: 1000, K229486: 0 })
    const seen: number[][] = []
    for (let i = 0; i < 8; i++) {
      await runNight(sim.db, { FD400039: 2800, K229486: 6000 })
      seen.push([sim.stock.get('FD400039')!, sim.stock.get('K229486')!])
    }
    expect(seen).toEqual(Array(8).fill([2800, 6000]))
    // 2 history rows + exactly one correction per SKU, then nothing.
    expect(sim.adjustments).toHaveLength(4)
  })

  it('applies each later Erply change exactly once', async () => {
    const sim = simDb({ F1: 1000 })
    const erply = [1000, 999, 999, 999, 1000, 1000, 998, 998]
    const seen: number[] = []
    for (const qty of erply) {
      await runNight(sim.db, { F1: qty })
      seen.push(sim.stock.get('F1')!)
    }
    expect(seen).toEqual(erply)
  })

  // The design (see the function's doc): a catalog-side change bridges the
  // gap until Erply reflects it, and is not counted twice once it does.
  it('keeps an order decrement until Erply catches up, without double-counting it', async () => {
    const sim = simDb({ F1: 1000 })
    await runNight(sim.db, { F1: 2800 })
    vi.setSystemTime(Date.now() + 3_600_000)
    sim.orderDecrement('F1', 10)
    await runNight(sim.db, { F1: 2800 }) // Erply hasn't seen the order yet
    expect(sim.stock.get('F1')).toBe(2790)
    await runNight(sim.db, { F1: 2790 }) // now it has
    expect(sim.stock.get('F1')).toBe(2790)
    await runNight(sim.db, { F1: 2790 })
    expect(sim.stock.get('F1')).toBe(2790)
  })

  // adjustment timestamps come from the database's clock; if it runs ahead
  // of ours, an anchor from our clock alone would land BEFORE this run's
  // own writes and bring the double-apply back.
  it('stays put when the database clock runs ahead of ours', async () => {
    const sim = simDb({ F1: 1000 }, { dbClockSkewMs: 2_000 })
    for (let i = 0; i < 6; i++) await runNight(sim.db, { F1: 2800 })
    expect(sim.stock.get('F1')).toBe(2800)
    expect(sim.adjustments).toHaveLength(2)
  })

  it('still leaves an Erply 0 ("not counted yet") untouched', async () => {
    const sim = simDb({ F1: 999 })
    for (let i = 0; i < 3; i++) await runNight(sim.db, { F1: 0 })
    expect(sim.stock.get('F1')).toBe(999)
    expect(sim.adjustments).toHaveLength(1)
  })

  // Erply sends a plain 0 for a SKU never counted, and '0.000000' for one
  // that sold through. Only the first is 'not counted'.
  it('takes a counted SKU that sold through down to 0', async () => {
    const sim = simDb({ F1: 40, F2: 999 })
    night++
    vi.setSystemTime(Date.parse('2026-10-01T08:33:00Z') + night * DAY)
    const r = await syncStockFromErply(
      [
        { sku: 'F1', stockQty: 0, counted: true },
        { sku: 'F2', stockQty: 0, counted: false },
      ],
      sim.db as never,
    )
    expect(sim.stock.get('F1')).toBe(0)
    expect(sim.stock.get('F2')).toBe(999)
    expect(r).toMatchObject({ changed: 1, skippedUncounted: 1 })
  })
})
