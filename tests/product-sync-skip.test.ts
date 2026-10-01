import { describe, it, expect, vi } from 'vitest'

// syncToSupabase dynamically imports these after the upsert; keep them inert.
vi.mock('../lib/low-stock-alert', () => ({ checkLowStockAndNotify: async () => {} }))
vi.mock('../lib/back-in-stock-notify', () => ({ checkBackInStockAndNotify: async () => {} }))

import { syncToSupabase, type SyncOptions, type SyncProduct } from '../lib/product-sync'

/**
 * Minimal chainable stand-in for the supabase-js client: every builder method
 * returns the builder, awaiting it resolves a canned result, and upserts are
 * recorded so the test can see exactly which keys each chunk carried.
 */
function fakeDb(existingSkus: string[]) {
  const upserts: Record<string, unknown>[][] = []
  const updates: Record<string, unknown>[] = []
  const from = (table: string) => {
    const calls: [string, unknown[]][] = []
    const resolve = () => {
      const has = (m: string) => calls.some(([name]) => name === m)
      const args = (m: string) => calls.find(([name]) => name === m)?.[1] ?? []
      if (table === 'categories') {
        if (has('upsert')) return { data: { id: 'cat-new' }, error: null }
        return { data: [{ id: 'cat-1', name: 'Toys' }], error: null }
      }
      if (table === 'products' && has('upsert')) {
        upserts.push(args('upsert')[0] as Record<string, unknown>[])
        return { error: null }
      }
      if (table === 'products' && has('update')) {
        updates.push(args('update')[0] as Record<string, unknown>)
        return { data: [], error: null }
      }
      if (table === 'products' && has('range')) {
        const [lo, hi] = args('range') as [number, number]
        return { data: existingSkus.slice(lo, hi + 1).map((sku) => ({ sku })), error: null }
      }
      return { data: [], error: null }
    }
    const builder: unknown = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') {
            return (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) =>
              Promise.resolve(resolve()).then(ok, bad)
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
  return { db: { from } as never, upserts, updates }
}

const product = (sku: string): SyncProduct => ({
  sku,
  barcode: null,
  name: `Name ${sku}`,
  price_cents: 100,
  description: `Erply text for ${sku}`,
  stock_qty: 0,
  image_url: null,
  is_active: true,
  category_name: 'Toys',
})

describe('syncToSupabase insert-only skipFields', () => {
  it('never puts a new and an existing product in the same upsert chunk', async () => {
    const { db, upserts } = fakeDb(['OLD1', 'OLD2'])
    await syncToSupabase([product('OLD1'), product('NEW1'), product('OLD2')], db, {
      skipFields: ['image_url', 'stock_qty', 'category', 'description'],
    })

    expect(upserts).toHaveLength(2)
    const [updates, inserts] = upserts
    expect(updates.map((r) => r.sku)).toEqual(['OLD1', 'OLD2'])
    expect(inserts.map((r) => r.sku)).toEqual(['NEW1'])

    // Existing rows carry neither insert-only key, so the column list sent for
    // their chunk cannot include it and nothing is NULLed.
    for (const r of updates) {
      expect(r).not.toHaveProperty('description')
      expect(r).not.toHaveProperty('category_id')
    }
    // A new product still gets Erply's description and category.
    expect(inserts[0].description).toBe('Erply text for NEW1')
    expect(inserts[0].category_id).toBe('cat-1')
  })

  it('still writes description on update when it is not skipped', async () => {
    const { db, upserts } = fakeDb(['OLD1'])
    await syncToSupabase([product('OLD1')], db)
    expect(upserts[0][0].description).toBe('Erply text for OLD1')
  })
})

// The options app/api/import/route.ts passes for an Excel sheet.
const EXCEL: SyncOptions = {
  deactivateMissing: false,
  skipFields: ['category', 'description'],
  keepExistingWhenBlank: ['image_url', 'stock_qty'],
}

describe('syncToSupabase with the Excel import options', () => {
  it('deactivates nothing missing from the sheet', async () => {
    const { db, updates } = fakeDb(['OLD1', 'OLD2'])
    await syncToSupabase([product('OLD1')], db, EXCEL)
    expect(updates.some((u) => u.is_active === false)).toBe(false)
  })

  it('still deactivates missing products by default (Erply sync)', async () => {
    const { db, updates } = fakeDb(['OLD1', 'OLD2'])
    await syncToSupabase([product('OLD1')], db)
    expect(updates.some((u) => u.is_active === false)).toBe(true)
  })

  it('keeps a stored image and stock when the cell is blank, and splits batches by key set', async () => {
    const { db, upserts } = fakeDb(['BLANK', 'FILLED'])
    const blank = { ...product('BLANK'), image_url: null, stock_qty: null }
    const filled = { ...product('FILLED'), image_url: 'https://res.cloudinary.com/x/image/upload/FILLED.jpg', stock_qty: 7 }
    await syncToSupabase([blank, filled], db, EXCEL)

    const rows = upserts.flat()
    const b = rows.find((r) => r.sku === 'BLANK')!
    const f = rows.find((r) => r.sku === 'FILLED')!
    expect(b).not.toHaveProperty('image_url')
    expect(b).not.toHaveProperty('stock_qty')
    expect(f.image_url).toBe('https://res.cloudinary.com/x/image/upload/FILLED.jpg')
    expect(f.stock_qty).toBe(7)
    // Different key sets must never share a chunk, or BLANK would be sent
    // image_url/stock_qty = NULL by the union-of-keys mechanism.
    for (const chunk of upserts) {
      const sigs = new Set(chunk.map((r) => Object.keys(r).sort().join(',')))
      expect(sigs.size).toBe(1)
    }
    // Description and category are never written to existing rows.
    for (const r of rows) {
      expect(r).not.toHaveProperty('description')
      expect(r).not.toHaveProperty('category_id')
    }
  })

  it('gives a new product stock 0 when the cell is blank', async () => {
    const { db, upserts } = fakeDb([])
    await syncToSupabase([{ ...product('NEW1'), stock_qty: null }], db, EXCEL)
    const r = upserts.flat()[0]
    expect(r.stock_qty).toBe(0)
    expect(r.description).toBe('Erply text for NEW1')
  })
})
