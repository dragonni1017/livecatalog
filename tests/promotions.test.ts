import { describe, expect, it } from 'vitest'
import { applyTierDiscount } from '../lib/order-rules'
import { normalizePromoCode, parsePromotionInput, priceWithPromotion, promotionStatus, type Promotion } from '../lib/promotions'

const promo = (over: Partial<Promotion> = {}): Promotion => ({
  id: 'p1', code: 'HOLIDAY10', name: 'Holiday', percent_off: 10, is_active: true, starts_on: null, ends_on: null,
  scope_kind: 'all', scope_collection_id: null, scope_category_id: null, min_subtotal_cents: null, max_uses: null, times_used: 0,
  ...over,
})

describe('normalizePromoCode', () => {
  it('trims and uppercases; rejects junk', () => {
    expect(normalizePromoCode(' holiday10 ')).toBe('HOLIDAY10')
    expect(normalizePromoCode('VIP_2026-A')).toBe('VIP_2026-A')
    for (const bad of ['', 'ab', 'x'.repeat(33), 'HOLI DAY', "a'; drop", 42, null]) expect(normalizePromoCode(bad), String(bad)).toBeNull()
  })
})

describe('promotionStatus', () => {
  it('active, in window, under cap → ok', () => {
    expect(promotionStatus(promo({ starts_on: '2026-10-01', ends_on: '2026-10-31', max_uses: 5, times_used: 4 }), '2026-10-16')).toEqual({ ok: true })
  })
  it('window is inclusive; off, early, expired and capped are refused with a reason', () => {
    expect(promotionStatus(promo({ ends_on: '2026-10-16' }), '2026-10-16').ok).toBe(true)
    expect(promotionStatus(promo({ is_active: false }), '2026-10-16')).toEqual({ ok: false, reason: "HOLIDAY10 isn't active." })
    expect(promotionStatus(promo({ starts_on: '2026-10-17' }), '2026-10-16')).toEqual({ ok: false, reason: 'HOLIDAY10 starts 2026-10-17.' })
    expect(promotionStatus(promo({ ends_on: '2026-10-15' }), '2026-10-16')).toEqual({ ok: false, reason: 'HOLIDAY10 has expired.' })
    expect(promotionStatus(promo({ max_uses: 5, times_used: 5 }), '2026-10-16')).toEqual({ ok: false, reason: 'HOLIDAY10 has reached its limit.' })
  })
})

describe('priceWithPromotion — better of the two, never stacked', () => {
  const lines = [
    { product_id: 'a', base_total_cents: 10_000 },
    { product_id: 'b', base_total_cents: 2_550 },
  ]

  it('no tier: the code discounts every line (rounded like every discount)', () => {
    const r = priceWithPromotion(lines, { tierPct: 0, promo: promo() })
    expect(r.totals).toEqual([applyTierDiscount(10_000, 10), applyTierDiscount(2_550, 10)])
    expect(r.applied).toBe(true)
    expect(r.promoDiscountCents).toBe(12_550 - r.totals[0] - r.totals[1])
  })

  it('a deeper tier wins: a 10% code does nothing for a 50% wholesale buyer', () => {
    const r = priceWithPromotion(lines, { tierPct: 50, promo: promo() })
    expect(r.totals).toEqual([applyTierDiscount(10_000, 50), applyTierDiscount(2_550, 50)])
    expect(r.applied).toBe(false)
    expect(r.promoDiscountCents).toBe(0)
    expect(r.reason).toBe('Your pricing is already better than HOLIDAY10.')
  })

  it('a deeper code wins over a shallower tier, and never stacks on it', () => {
    const r = priceWithPromotion(lines, { tierPct: 5, promo: promo({ percent_off: 20 }) })
    expect(r.totals).toEqual([applyTierDiscount(10_000, 20), applyTierDiscount(2_550, 20)])
    // not 20% off the 5%-off price:
    expect(r.totals[0]).not.toBe(applyTierDiscount(applyTierDiscount(10_000, 5), 20))
    expect(r.subtotalBeforeCents).toBe(applyTierDiscount(10_000, 5) + applyTierDiscount(2_550, 5))
  })

  it('without a code, it is exactly the old tier pricing (positive tiers only)', () => {
    expect(priceWithPromotion(lines, { tierPct: 50 }).totals).toEqual([5_000, applyTierDiscount(2_550, 50)])
    expect(priceWithPromotion(lines, { tierPct: 0 }).totals).toEqual([10_000, 2_550])
    expect(priceWithPromotion(lines, { tierPct: -10 }).totals).toEqual([10_000, 2_550]) // dormant markups untouched, as before
  })

  it('hand-priced (rep override) lines keep their price', () => {
    const r = priceWithPromotion([{ ...lines[0], overridden: true }, lines[1]], { tierPct: 0, promo: promo() })
    expect(r.totals[0]).toBe(10_000)
    expect(r.totals[1]).toBe(applyTierDiscount(2_550, 10))
  })

  it('scope: only eligible products are discounted; none eligible → not applied', () => {
    const r = priceWithPromotion(lines, { tierPct: 0, promo: promo(), eligible: (id) => id === 'b' })
    expect(r.totals).toEqual([10_000, applyTierDiscount(2_550, 10)])
    const none = priceWithPromotion(lines, { tierPct: 0, promo: promo(), eligible: () => false })
    expect(none.applied).toBe(false)
    expect(none.reason).toBe("HOLIDAY10 doesn't apply to anything in your cart.")
  })

  it('minimum order is checked against the subtotal before the code', () => {
    const r = priceWithPromotion(lines, { tierPct: 0, promo: promo({ min_subtotal_cents: 20_000 }) })
    expect(r.applied).toBe(false)
    expect(r.totals).toEqual([10_000, 2_550])
    expect(r.reason).toBe('HOLIDAY10 needs an order of $200.00 or more.')
    expect(priceWithPromotion(lines, { tierPct: 0, promo: promo({ min_subtotal_cents: 12_550 }) }).applied).toBe(true)
  })
})

describe('parsePromotionInput', () => {
  const ok = { code: 'holiday10', name: 'Holiday', percent_off: '10' }
  it('normalizes and converts dollars to cents', () => {
    const r = parsePromotionInput({ ...ok, min_subtotal: '250.5', max_uses: '50', starts_on: '2026-11-01', ends_on: '2026-12-31' })
    expect(r).toMatchObject({ value: { code: 'HOLIDAY10', percent_off: 10, min_subtotal_cents: 25_050, max_uses: 50, scope_kind: 'all' } })
  })
  it('refuses bad input', () => {
    const bad: Record<string, unknown>[] = [
      { ...ok, code: 'x' },
      { ...ok, name: '' },
      { ...ok, percent_off: '0' },
      { ...ok, percent_off: '95' },
      { ...ok, percent_off: '10.555' },
      { ...ok, starts_on: '2026-12-31', ends_on: '2026-11-01' },
      { ...ok, scope_kind: 'collection', scope_collection_id: 'not-a-uuid' },
      { ...ok, scope_kind: 'category', scope_category_id: '' },
      { ...ok, min_subtotal: '-1' },
      { ...ok, max_uses: '0' },
      { ...ok, max_uses: '2.5' },
    ]
    for (const b of bad) expect(parsePromotionInput(b), JSON.stringify(b)).toHaveProperty('error')
  })
})
