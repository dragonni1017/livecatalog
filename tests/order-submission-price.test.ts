import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ getAdminClient: () => { throw new Error('not used') } }))

import { buildLineItems } from '@/lib/order-submission'

type Row = { id: string; sku: string; name: string; price_cents: number; stock_qty: number; is_active: boolean; manually_hidden: boolean; volume_tiers: unknown }

function fakeDb(rows: Row[]) {
  const builder = {
    select: () => builder,
    in: async () => ({ data: rows, error: null }),
  }
  return { from: () => builder } as never
}

const row = (id: string, price_cents: number, extra: Partial<Row> = {}): Row => ({
  id, sku: id.toUpperCase(), name: `Name ${id}`, price_cents, stock_qty: 100,
  is_active: true, manually_hidden: false, volume_tiers: null, ...extra,
})

describe('buildLineItems never prices a line at $0', () => {
  it('drops a visible product with no price and keeps the priced one', async () => {
    const db = fakeDb([row('a', 0), row('b', 450)])
    const built = await buildLineItems(db, [{ productId: 'a', qty: 2 }, { productId: 'b', qty: 2 }] as never)
    if ('error' in built) throw new Error(built.error)
    expect(built.lineItems.map((l) => l.product_id)).toEqual(['b'])
  })

  it('drops a line whose volume tier is $0', async () => {
    const db = fakeDb([row('a', 450, { volume_tiers: [{ min_qty: 10, price_cents: 0 }] })])
    const built = await buildLineItems(db, [{ productId: 'a', qty: 12 }] as never)
    if ('error' in built) throw new Error(built.error)
    expect(built.lineItems).toEqual([])
  })

  it('does not list a dropped $0 product as out of stock', async () => {
    const db = fakeDb([row('a', 0, { stock_qty: 0 })])
    const built = await buildLineItems(db, [{ productId: 'a', qty: 5 }] as never)
    if ('error' in built) throw new Error(built.error)
    expect(built.outOfStock).toEqual([])
  })

  it('still prices a normal line', async () => {
    const db = fakeDb([row('a', 450, { volume_tiers: [{ min_qty: 10, price_cents: 400 }] })])
    const built = await buildLineItems(db, [{ productId: 'a', qty: 12 }] as never)
    if ('error' in built) throw new Error(built.error)
    expect(built.lineItems[0]).toMatchObject({ unit_price_cents: 400, qty: 12, line_total_cents: 4800 })
  })
})
