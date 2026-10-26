import { describe, it, expect, vi } from 'vitest'

// syncToSupabase dynamically imports these after the upsert; keep them inert.
vi.mock('../lib/low-stock-alert', () => ({ checkLowStockAndNotify: async () => {} }))
vi.mock('../lib/back-in-stock-notify', () => ({ checkBackInStockAndNotify: async () => {} }))

import { planDeactivation, resolveCategories, syncToSupabase, type SyncOptions, type SyncProduct } from '../lib/product-sync'

/**
 * Minimal chainable stand-in for the supabase-js client: every builder method
 * returns the builder, awaiting it resolves a canned result, and upserts are
 * recorded so the test can see exactly which keys each chunk carried.
 */
const CATEGORIES = [
  { id: 'cat-1', name: 'Toys', slug: 'toys' },
  { id: 'cat-064', name: 'Seasonal & Holiday', slug: 'seasonal-holiday' },
]

function fakeDb(existingSkus: string[], visibleSkus: string[] = []) {
  const categoryWrites: string[] = []
  const upserts: Record<string, unknown>[][] = []
  const updates: Record<string, unknown>[] = []
  const from = (table: string) => {
    const calls: [string, unknown[]][] = []
    const resolve = () => {
      const has = (m: string) => calls.some(([name]) => name === m)
      const args = (m: string) => calls.find(([name]) => name === m)?.[1] ?? []
      if (table === 'categories') {
        if (has('upsert') || has('update') || has('insert')) categoryWrites.push(calls.map(([m]) => m).join('.'))
        return { data: CATEGORIES, error: null }
      }
      if (table === 'products' && has('upsert')) {
        upserts.push(args('upsert')[0] as Record<string, unknown>[])
        return { error: null }
      }
      if (table === 'products' && has('update')) {
        updates.push(args('update')[0] as Record<string, unknown>)
        // The zero-price hide (step 4c) is filtered to visible rows and reads
        // back which SKUs it hid.
        const onlyVisible = calls.some(([m, a]) => m === 'eq' && a[0] === 'manually_hidden' && a[1] === false)
        if (onlyVisible) {
          const skus = (args('in')[1] as string[]) ?? []
          return { data: skus.filter((s) => visibleSkus.includes(s)).map((sku) => ({ sku })), error: null }
        }
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
  return { db: { from } as never, upserts, updates, categoryWrites }
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

describe('resolveCategories', () => {
  it('matches existing categories and never writes one, even for an unknown name', async () => {
    const { db, categoryWrites } = fakeDb([])
    const map = await resolveCategories(['Toys', 'toys', 'Christmas', 'Garden Tools'], db)
    expect(map).toEqual({ Toys: 'cat-1', toys: 'cat-1', Christmas: 'cat-064' })
    expect(categoryWrites).toEqual([])
  })
})

describe('syncToSupabase uncategorized', () => {
  it('reports NEW products whose category matched nothing, not existing ones', async () => {
    const { db } = fakeDb(['OLD1'])
    const odd = (sku: string): SyncProduct => ({ ...product(sku), category_name: 'Garden Tools' })
    const result = await syncToSupabase([odd('OLD1'), odd('NEW1'), product('NEW2')], db, {
      skipFields: ['image_url', 'stock_qty', 'category', 'description'],
    })
    expect(result.uncategorized).toEqual([{ sku: 'NEW1', category: 'Garden Tools' }])
  })
})

describe('planDeactivation', () => {
  const active = (skus: (string | null)[]) => skus.map((sku) => ({ sku }))

  it('deactivates exactly the active SKUs missing from the feed, never a null SKU', () => {
    expect(planDeactivation(active(['A', 'B', 'c', null]), ['A', 'C'])).toEqual({ skus: ['B', 'c'], refused: null })
  })

  // Real numbers from 2026-10-21: 3,361 active, 3,215 in Erply, 146 to go.
  it('lets a normal night through', () => {
    const skus = Array.from({ length: 3361 }, (_, i) => `S${i}`)
    const plan = planDeactivation(active(skus), skus.slice(0, 3215))
    expect(plan.refused).toBeNull()
    expect(plan.skus).toHaveLength(146)
  })

  // The old NOT IN would have deactivated the whole catalog on a short feed.
  it('refuses a run that would deactivate more than 10% of a real-sized catalog', () => {
    const skus = Array.from({ length: 3361 }, (_, i) => `S${i}`)
    const plan = planDeactivation(active(skus), skus.slice(0, 200))
    expect(plan.skus).toEqual([])
    expect(plan.refused).toMatch(/refused to deactivate 3161 of 3361 active products \(limit 336\)/)
  })

  it('always allows up to 20, so a small catalog is not stuck', () => {
    const skus = Array.from({ length: 25 }, (_, i) => `S${i}`)
    expect(planDeactivation(active(skus), skus.slice(0, 5)).refused).toBeNull()
    expect(planDeactivation(active(skus), skus.slice(0, 4)).refused).not.toBeNull()
  })
})

describe('syncToSupabase deactivation guard', () => {
  it('deactivates nothing and reports why when the feed is implausibly short', async () => {
    const existing = Array.from({ length: 300 }, (_, i) => `S${i}`)
    const { db, updates } = fakeDb(existing)
    const result = await syncToSupabase([product('S0')], db)
    expect(updates.some((u) => u.is_active === false)).toBe(false)
    expect(result.deactivated).toBe(0)
    expect(result.errors.map((e) => e.message)).toEqual([expect.stringMatching(/^refused to deactivate 299 of 300/)])
  })
})

describe('syncToSupabase zero-price hide', () => {
  const zero = (sku: string): SyncProduct => ({ ...product(sku), price_cents: 0 })

  it('hides an existing visible product whose price is now 0, and marks it awaiting a price', async () => {
    const { db, updates } = fakeDb(['LIVE', 'HIDDEN', 'PRICED'], ['LIVE', 'PRICED'])
    const result = await syncToSupabase([zero('LIVE'), zero('HIDDEN'), product('PRICED')], db, { deactivateMissing: false })
    expect(result.zeroPriceHidden).toEqual(['LIVE'])
    expect(updates).toContainEqual({ manually_hidden: true, awaiting_price: true })
  })

  it('hides nothing when every product has a price', async () => {
    const { db, updates } = fakeDb(['A', 'B'], ['A', 'B'])
    const result = await syncToSupabase([product('A'), product('B')], db, { deactivateMissing: false })
    expect(result.zeroPriceHidden).toEqual([])
    expect(updates.some((u) => u.manually_hidden === true)).toBe(false)
  })
})
