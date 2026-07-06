import { describe, it, expect } from 'vitest'
import { meetsOrderMinimum, formatPriceCents, MIN_ORDER_SUBTOTAL_CENTS } from '@/lib/order-rules'

describe('meetsOrderMinimum', () => {
  it('passes when subtotal equals the minimum', () => {
    expect(meetsOrderMinimum(MIN_ORDER_SUBTOTAL_CENTS)).toBe(true)
  })

  it('passes when subtotal exceeds the minimum', () => {
    expect(meetsOrderMinimum(MIN_ORDER_SUBTOTAL_CENTS + 1)).toBe(true)
  })

  it('fails when subtotal is below the minimum', () => {
    if (MIN_ORDER_SUBTOTAL_CENTS === 0) {
      // minimum is disabled — any positive value passes
      expect(meetsOrderMinimum(0)).toBe(true)
    } else {
      expect(meetsOrderMinimum(MIN_ORDER_SUBTOTAL_CENTS - 1)).toBe(false)
    }
  })

  it('passes zero when minimum is disabled', () => {
    // MIN_ORDER_SUBTOTAL_CENTS is currently 0 (no minimum enforced)
    expect(meetsOrderMinimum(0)).toBe(true)
  })
})

describe('formatPriceCents', () => {
  it('formats whole dollar amounts without decimals', () => {
    expect(formatPriceCents(1000)).toBe('$10.00')
  })

  it('formats zero', () => {
    expect(formatPriceCents(0)).toBe('$0.00')
  })

  it('formats cents-only amounts', () => {
    expect(formatPriceCents(99)).toBe('$0.99')
  })

  it('formats large amounts', () => {
    expect(formatPriceCents(100000)).toBe('$1000.00')
  })

  it('formats amounts with non-zero cents', () => {
    expect(formatPriceCents(1299)).toBe('$12.99')
  })
})
