import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// POST /api/cart/reprice reports the lines the order would drop, so the cart
// can mark them instead of letting them vanish from the request.

vi.mock('../lib/auth-server', () => ({ getSessionUser: async () => null }))
vi.mock('../lib/supabase', () => {
  const products = [
    { id: 'ok', sku: 'OK1', name: 'Bow', price_cents: 450, stock_qty: 10, is_active: true, manually_hidden: false, volume_tiers: null },
    { id: 'hidden', sku: 'HID', name: 'Box', price_cents: 450, stock_qty: 10, is_active: true, manually_hidden: true, volume_tiers: null },
    { id: 'off', sku: 'OFF', name: 'Bag', price_cents: 450, stock_qty: 10, is_active: false, manually_hidden: false, volume_tiers: null },
    { id: 'free', sku: 'ZERO', name: 'Cup', price_cents: 0, stock_qty: 10, is_active: true, manually_hidden: false, volume_tiers: null },
  ]
  const from = () => {
    let rows: Record<string, unknown>[] = products
    const b: Record<string, unknown> = {
      select: () => b,
      in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return b },
      then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
    }
    return b
  }
  return { getAdminClient: () => ({ from }) }
})

const { POST } = await import('../app/api/cart/reprice/route')

const reprice = async (ids: string[]) => {
  const res = await POST(new NextRequest('http://x/api/cart/reprice', {
    method: 'POST',
    body: JSON.stringify({ items: ids.map((productId) => ({ productId, qty: 1 })) }),
  }))
  return res.json() as Promise<{ prices: Record<string, number>; unavailable: string[] }>
}

describe('cart reprice: unavailable lines', () => {
  it('lists hidden, inactive, $0 and deleted products, and prices the rest', async () => {
    const data = await reprice(['ok', 'hidden', 'off', 'free', 'deleted'])
    expect(Object.keys(data.prices)).toEqual(['ok'])
    expect(data.unavailable.sort()).toEqual(['deleted', 'free', 'hidden', 'off'])
  })

  it('reports nothing unavailable for a normal cart', async () => {
    const data = await reprice(['ok'])
    expect(data.unavailable).toEqual([])
  })
})
