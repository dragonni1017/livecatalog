import { describe, expect, it, vi } from 'vitest'
import { backorderQty, buildLineItems, saveBackorders, type LineItem } from '@/lib/order-submission'

describe('backorderQty', () => {
  it('is the part of the line over stock, never negative', () => {
    expect(backorderQty(5, 10)).toBe(0)
    expect(backorderQty(10, 10)).toBe(0)
    expect(backorderQty(12, 10)).toBe(2)
    expect(backorderQty(4, 0)).toBe(4)
    // oversold stock counts as none, not as extra backorder
    expect(backorderQty(4, -3)).toBe(4)
    expect(backorderQty(4, null)).toBe(4)
  })
})

const product = (over: Record<string, unknown>) => ({
  id: 'p1', sku: 'S1', name: 'Thing', price_cents: 100, stock_qty: 10,
  is_active: true, manually_hidden: false, volume_tiers: null, ...over,
})

function productsDb(rows: unknown[]) {
  return { from: () => ({ select: () => ({ in: async () => ({ data: rows, error: null }) }) }) }
}

describe('buildLineItems backorders', () => {
  it('keeps over-stock and sold-out lines on the order, flagged', async () => {
    const db = productsDb([
      product({ id: 'in', sku: 'IN', stock_qty: 10 }),
      product({ id: 'part', sku: 'PART', stock_qty: 3 }),
      product({ id: 'none', sku: 'NONE', stock_qty: 0 }),
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const built = await buildLineItems(db as any, [
      { productId: 'in', qty: 5 },
      { productId: 'part', qty: 5 },
      { productId: 'none', qty: 2 },
    ])
    if ('error' in built) throw new Error(built.error)
    expect(built.lineItems.map((li) => [li.sku, li.qty, li.backorder_qty])).toEqual([
      ['IN', 5, 0],
      ['PART', 5, 2],
      ['NONE', 2, 2],
    ])
    expect(built.outOfStock).toHaveLength(2)
    expect(built.outOfStock[0]).toContain('2 backordered')
  })

  it('still drops hidden products, backordered or not', async () => {
    const db = productsDb([product({ id: 'h', manually_hidden: true, stock_qty: 0 })])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const built = await buildLineItems(db as any, [{ productId: 'h', qty: 1 }])
    if ('error' in built) throw new Error(built.error)
    expect(built.lineItems).toEqual([])
  })
})

describe('saveBackorders', () => {
  it('updates only the backordered lines of that order', async () => {
    const calls: unknown[] = []
    const db = {
      from: () => ({
        update: (values: unknown) => ({
          eq: (_c1: string, orderId: string) => ({
            eq: async (_c2: string, productId: string) => {
              calls.push({ values, orderId, productId })
              return { error: null }
            },
          }),
        }),
      }),
    }
    const line = (product_id: string, backorder_qty: number): LineItem => ({
      product_id, sku: product_id, name: product_id, unit_price_cents: 1, qty: 5, line_total_cents: 5, backorder_qty,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await saveBackorders(db as any, 'order-1', [line('a', 0), line('b', 3)])
    expect(calls).toEqual([{ values: { backorder_qty: 3 }, orderId: 'order-1', productId: 'b' }])
  })

  it('logs and carries on when the column is missing (migration not run)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = { from: () => ({ update: () => ({ eq: () => ({ eq: async () => ({ error: { message: 'column does not exist' } }) }) }) }) }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(saveBackorders(db as any, 'o', [{ product_id: 'b', sku: 'B', name: 'B', unit_price_cents: 1, qty: 1, line_total_cents: 1, backorder_qty: 1 }])).resolves.toBeUndefined()
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})
