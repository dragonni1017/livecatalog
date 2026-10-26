import { describe, expect, it } from 'vitest'
import { touchesZeroPriceRule, zeroPriceBlock } from '@/lib/visibility-guard'

const hiddenUnpriced = { manually_hidden: true, price_cents: 0 }
const visiblePriced = { manually_hidden: false, price_cents: 450 }

describe('zeroPriceBlock', () => {
  it('refuses to unhide a product with no price', () => {
    expect(zeroPriceBlock(hiddenUnpriced, { manually_hidden: false })).toBe('unhide_unpriced')
    expect(zeroPriceBlock({ manually_hidden: true, price_cents: null }, { manually_hidden: false })).toBe('unhide_unpriced')
  })

  it('refuses to zero the price of a visible product', () => {
    expect(zeroPriceBlock(visiblePriced, { price_cents: 0 })).toBe('zero_visible')
  })

  it('allows unhiding when the same edit sets a real price', () => {
    expect(zeroPriceBlock(hiddenUnpriced, { manually_hidden: false, price_cents: 100 })).toBeNull()
  })

  it('allows unhiding a priced product, and any edit that leaves it hidden', () => {
    expect(zeroPriceBlock({ manually_hidden: true, price_cents: 450 }, { manually_hidden: false })).toBeNull()
    expect(zeroPriceBlock(hiddenUnpriced, { price_cents: 0 })).toBeNull()
    expect(zeroPriceBlock(visiblePriced, { manually_hidden: true, price_cents: 0 })).toBeNull()
  })
})

describe('touchesZeroPriceRule', () => {
  it('flags only unhiding or a zero price', () => {
    expect(touchesZeroPriceRule({ manually_hidden: false })).toBe(true)
    expect(touchesZeroPriceRule({ price_cents: 0 })).toBe(true)
    expect(touchesZeroPriceRule({ manually_hidden: true })).toBe(false)
    expect(touchesZeroPriceRule({ price_cents: 100 })).toBe(false)
    expect(touchesZeroPriceRule({})).toBe(false)
  })
})
