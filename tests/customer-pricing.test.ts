import { describe, expect, it } from 'vitest'
import { pickCustomerPricing, resolveCustomerPricing } from '../lib/customer-pricing'
import { parsePriceParam, resolvePriceScope, loadPriceOptions } from '../lib/price-scope'
import { applyTierDiscount } from '../lib/order-rules'

const wholesale = { code: 'wholesale', label: 'Wholesale', discount_percent: '50.00', active: true }
const base = { code: 'base', label: 'Base', discount_percent: '0', active: false }

describe('pickCustomerPricing (the one rule for order, cart and price list)', () => {
  it('uses an active assigned tier', () => {
    expect(pickCustomerPricing({ discount_percent: 0, price_tier_code: 'wholesale' }, wholesale)).toEqual({
      discountPct: 50,
      tierCode: 'wholesale',
      tierLabel: 'Wholesale',
    })
  })
  it('the tier wins over a flat discount (never stacked)', () => {
    expect(pickCustomerPricing({ discount_percent: 10, price_tier_code: 'wholesale' }, wholesale).discountPct).toBe(50)
  })
  it('falls back to the flat discount when the tier is inactive or missing', () => {
    expect(pickCustomerPricing({ discount_percent: '12.5', price_tier_code: 'base' }, base)).toEqual({ discountPct: 12.5, tierCode: null, tierLabel: null })
    expect(pickCustomerPricing({ discount_percent: 7, price_tier_code: 'gone' }, null).discountPct).toBe(7)
  })
  it("ignores a tier row that isn't the customer's assigned tier", () => {
    expect(pickCustomerPricing({ discount_percent: 0, price_tier_code: 'exclusive' }, wholesale).discountPct).toBe(0)
  })
  it('no customer, or nothing set, means catalog price', () => {
    expect(pickCustomerPricing(null, wholesale).discountPct).toBe(0)
    expect(pickCustomerPricing({ discount_percent: null, price_tier_code: null }, null).discountPct).toBe(0)
  })
})

describe('parsePriceParam', () => {
  it('reads tier and customer params', () => {
    expect(parsePriceParam('tier:wholesale')).toEqual({ kind: 'tier', code: 'wholesale' })
    expect(parsePriceParam('customer:0b7c6f5e-1d2a-4c3b-9e8f-7a6b5c4d3e2f')).toEqual({ kind: 'customer', id: '0b7c6f5e-1d2a-4c3b-9e8f-7a6b5c4d3e2f' })
  })
  it('anything malformed is catalog price', () => {
    for (const v of [undefined, '', 'tier:', 'tier:Bad Code', "tier:x' or 1=1", 'customer:not-a-uuid', 'wholesale']) {
      expect(parsePriceParam(v), String(v)).toEqual({ kind: 'catalog' })
    }
  })
})

// Minimal stand-in for the supabase-js query builder over in-memory tables.
function fakeDb(tables: Record<string, Record<string, unknown>[]>) {
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])]
    const builder = {
      select: () => builder,
      order: () => builder,
      eq: (col: string, val: unknown) => {
        rows = rows.filter((r) => r[col] === val)
        return builder
      },
      maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: rows, error: null }),
    }
    return builder
  }
  return { from } as never
}

const CUST_TIER = '11111111-1111-4111-8111-111111111111'
const CUST_FLAT = '22222222-2222-4222-8222-222222222222'
const CUST_NONE = '33333333-3333-4333-8333-333333333333'
const db = fakeDb({
  price_tiers: [wholesale, base, { code: 'exclusive', label: 'Exclusive', discount_percent: '38.00', active: true }],
  customers: [
    { id: CUST_TIER, email: 'acme@example.com', name: 'Ann', company: 'Acme Florist', discount_percent: 0, price_tier_code: 'wholesale' },
    { id: CUST_FLAT, email: 'flat@example.com', name: 'Flat Co', company: null, discount_percent: '15', price_tier_code: null },
    { id: CUST_NONE, email: 'none@example.com', name: null, company: null, discount_percent: 0, price_tier_code: null },
  ],
})

describe('resolveCustomerPricing', () => {
  it('looks the customer up case-insensitively', async () => {
    expect((await resolveCustomerPricing(db, '  ACME@example.com ')).discountPct).toBe(50)
    expect((await resolveCustomerPricing(db, 'flat@example.com')).discountPct).toBe(15)
    expect((await resolveCustomerPricing(db, 'nobody@example.com')).discountPct).toBe(0)
  })
})

describe('resolvePriceScope', () => {
  it('catalog by default', async () => {
    expect(await resolvePriceScope(db, undefined)).toEqual({ discountPct: 0, label: null })
  })
  it('an active tier', async () => {
    expect(await resolvePriceScope(db, 'tier:exclusive')).toEqual({ discountPct: 38, label: 'Exclusive tier, 38% off' })
  })
  it('an inactive or unknown tier falls back to catalog price', async () => {
    expect((await resolvePriceScope(db, 'tier:base')).discountPct).toBe(0)
    expect((await resolvePriceScope(db, 'tier:nope')).discountPct).toBe(0)
  })
  it("a customer gets exactly their own pricing, named in the header", async () => {
    expect(await resolvePriceScope(db, `customer:${CUST_TIER}`)).toEqual({ discountPct: 50, label: 'Acme Florist (Wholesale tier, 50% off)' })
    expect(await resolvePriceScope(db, `customer:${CUST_FLAT}`)).toEqual({ discountPct: 15, label: 'Flat Co (15% off)' })
  })
  it('the price shown equals what an order would charge', async () => {
    const scope = await resolvePriceScope(db, `customer:${CUST_TIER}`)
    const order = await resolveCustomerPricing(db, 'acme@example.com')
    for (const cents of [100, 1999, 2550, 33333]) {
      expect(applyTierDiscount(cents, scope.discountPct)).toBe(applyTierDiscount(cents, order.discountPct))
    }
  })
})

describe('loadPriceOptions', () => {
  it('lists active tiers and only customers whose pricing differs from catalog', async () => {
    const o = await loadPriceOptions(db)
    expect(o.tiers.map((t) => t.value)).toEqual(['tier:wholesale', 'tier:exclusive'])
    expect(o.customers.map((c) => c.value).sort()).toEqual([`customer:${CUST_TIER}`, `customer:${CUST_FLAT}`].sort())
  })
})
