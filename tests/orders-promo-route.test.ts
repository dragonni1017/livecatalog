import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { applyTierDiscount } from '../lib/order-rules'

// POST /api/orders with promo codes, against an in-memory stand-in for the DB.
// Proves the security-sensitive bits: the charge uses better-of pricing, a use
// is claimed atomically BEFORE the order is saved, bad codes save nothing, and
// a failed save gives the use back.

const state = vi.hoisted(() => ({
  promotions: [] as Record<string, unknown>[],
  claimResult: true as boolean,
  submitFails: false,
  calls: [] as { kind: string; name?: string; args?: unknown }[],
  submitted: null as null | Record<string, unknown>,
  orderUpdates: [] as Record<string, unknown>[],
}))

vi.mock('../lib/auth-server', () => ({ getSessionUser: async () => null }))
vi.mock('../lib/order-emails', () => ({ notifyReps: async () => {}, notifyCustomer: async () => {} }))
vi.mock('../lib/supabase', () => {
  const products = [
    { id: 'p1', sku: 'A1', name: 'Bow', price_cents: 50_000, stock_qty: 100, is_active: true, manually_hidden: false, volume_tiers: null },
    { id: 'p2', sku: 'B2', name: 'Box', price_cents: 25_000, stock_qty: 100, is_active: true, manually_hidden: false, volume_tiers: null },
  ]
  const from = (table: string) => {
    let rows: Record<string, unknown>[] =
      table === 'products' ? products : table === 'promotions' ? state.promotions : []
    let patch: Record<string, unknown> | null = null
    const b: Record<string, unknown> = {
      select: () => b,
      in: (col: string, vals: unknown[]) => { rows = rows.filter((r) => vals.includes(r[col])); return b },
      eq: (col: string, v: unknown) => {
        if (patch) state.orderUpdates.push({ ...patch, [col]: v })
        rows = rows.filter((r) => r[col] === undefined || r[col] === v)
        return b
      },
      is: () => b,
      like: () => b,
      update: (p: Record<string, unknown>) => { patch = p; return b },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null, count: 0 }),
    }
    return b
  }
  const rpc = async (name: string, args: Record<string, unknown>) => {
    state.calls.push({ kind: 'rpc', name, args })
    if (name === 'claim_promotion_use') return { data: state.claimResult, error: null }
    if (name === 'release_promotion_use') return { data: null, error: null }
    if (name === 'submit_order') {
      if (state.submitFails) return { data: null, error: { code: 'XX000', message: 'boom' } }
      state.submitted = args
      return { data: 'order-1', error: null }
    }
    return { data: null, error: null }
  }
  return { getAdminClient: () => ({ from, rpc }) }
})

const { POST } = await import('../app/api/orders/route')

const body = (extra: Record<string, unknown> = {}) => ({
  items: [{ productId: 'p1', qty: 1 }, { productId: 'p2', qty: 2 }],
  contact: { name: 'Buyer', email: 'buyer@example.com', shipAddress1: '1 Main', shipCity: 'Austin', shipState: 'TX', shipZip: '78701' },
  ...extra,
})
const post = (b: unknown) => POST(new NextRequest('http://x/api/orders', { method: 'POST', body: JSON.stringify(b) }))

const PROMO = {
  id: 'promo-1', code: 'HOLIDAY10', name: 'Holiday', percent_off: '10.00', is_active: true, starts_on: null, ends_on: null,
  scope_kind: 'all', scope_collection_id: null, scope_category_id: null, min_subtotal_cents: null, max_uses: 50, times_used: 3,
}

beforeEach(() => {
  // Without a Supabase URL the route answers in mock mode and skips the DB entirely.
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
  state.promotions = [PROMO]
  state.claimResult = true
  state.submitFails = false
  state.calls = []
  state.submitted = null
  state.orderUpdates = []
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('POST /api/orders with a promo code', () => {
  it('no code: unchanged pricing, no claim', async () => {
    const res = await post(body())
    expect(res.status).toBe(200)
    expect(state.calls.some((c) => c.name === 'claim_promotion_use')).toBe(false)
    expect(state.submitted?.p_subtotal_cents).toBe(50_000 + 50_000)
    expect(state.orderUpdates.filter((u) => 'promo_code' in u)).toEqual([])
  })

  it('valid code: claims a use BEFORE saving, charges the discounted lines, records code + savings', async () => {
    const res = await post(body({ promoCode: ' holiday10 ' }))
    expect(res.status).toBe(200)
    const names = state.calls.map((c) => c.name)
    expect(names.indexOf('claim_promotion_use')).toBeLessThan(names.indexOf('submit_order'))
    const expected = applyTierDiscount(50_000, 10) + applyTierDiscount(50_000, 10)
    expect(state.submitted?.p_subtotal_cents).toBe(expected)
    const items = state.submitted?.p_items as { line_total_cents: number }[]
    expect(items.map((i) => i.line_total_cents)).toEqual([applyTierDiscount(50_000, 10), applyTierDiscount(50_000, 10)])
    expect(state.orderUpdates).toContainEqual({ promo_code: 'HOLIDAY10', promo_discount_cents: 100_000 - expected, id: 'order-1' })
  })

  it('unknown code: 400 and nothing saved or claimed', async () => {
    const res = await post(body({ promoCode: 'NOPE99' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("NOPE99 isn't a valid code")
    expect(state.calls.map((c) => c.name)).not.toContain('submit_order')
    expect(state.calls.map((c) => c.name)).not.toContain('claim_promotion_use')
  })

  it('expired code: 400, nothing saved', async () => {
    state.promotions = [{ ...PROMO, ends_on: '2020-01-01' }]
    const res = await post(body({ promoCode: 'HOLIDAY10' }))
    expect(res.status).toBe(400)
    expect(state.submitted).toBeNull()
  })

  it('cap reached at claim time (race): 400, nothing saved', async () => {
    state.claimResult = false
    const res = await post(body({ promoCode: 'HOLIDAY10' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain('reached its limit')
    expect(state.submitted).toBeNull()
  })

  it('order save fails after the claim: the use is given back', async () => {
    state.submitFails = true
    const res = await post(body({ promoCode: 'HOLIDAY10' }))
    expect(res.status).toBe(500)
    expect(state.calls.filter((c) => c.name === 'release_promotion_use')).toEqual([{ kind: 'rpc', name: 'release_promotion_use', args: { p_id: 'promo-1' } }])
    expect(state.orderUpdates.filter((u) => 'promo_code' in u)).toEqual([])
  })

  it('code below its minimum: order goes through at normal prices, no claim, nothing recorded', async () => {
    state.promotions = [{ ...PROMO, min_subtotal_cents: 999_999 }]
    const res = await post(body({ promoCode: 'HOLIDAY10' }))
    expect(res.status).toBe(200)
    expect(state.submitted?.p_subtotal_cents).toBe(100_000)
    expect(state.calls.map((c) => c.name)).not.toContain('claim_promotion_use')
    expect(state.orderUpdates.filter((u) => 'promo_code' in u)).toEqual([])
  })
})
