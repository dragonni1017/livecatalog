import { describe, it, expect } from 'vitest'
import {
  meetsOrderMinimum,
  formatPriceCents,
  MIN_ORDER_SUBTOTAL_CENTS,
  roundCentsToQuarterSkip75,
  applyTierDiscount,
  formatTierAdjustment,
} from '@/lib/order-rules'

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

describe('roundCentsToQuarterSkip75', () => {
  it('leaves an already-clean quarter stop unchanged', () => {
    expect(roundCentsToQuarterSkip75(350)).toBe(350) // $3.50
    expect(roundCentsToQuarterSkip75(700)).toBe(700) // $7.00
    expect(roundCentsToQuarterSkip75(325)).toBe(325) // $3.25
  })

  it('rounds to the nearest of .00/.25/.50/next-dollar, never .75', () => {
    expect(roundCentsToQuarterSkip75(322)).toBe(325) // $3.22 -> $3.25
    expect(roundCentsToQuarterSkip75(434)).toBe(425) // $4.34 -> $4.25
    expect(roundCentsToQuarterSkip75(312)).toBe(300) // $3.12 -> $3.00 (closer to .00 than .25)
    expect(roundCentsToQuarterSkip75(363)).toBe(350) // $3.63 -> $3.50
    expect(roundCentsToQuarterSkip75(388)).toBe(400) // $3.88 is nearer the next dollar than .50
    // Exactly $3.75 is equidistant between .50 and the next dollar (25 cents
    // either way) — ties resolve to the lower stop (inherited from
    // lib/erply.ts's identical dollar-based tie-break, not something chosen
    // fresh here), so this rounds down to .50, not up.
    expect(roundCentsToQuarterSkip75(375)).toBe(350)
  })
})

describe('applyTierDiscount', () => {
  it('returns the input unchanged when there is no adjustment', () => {
    expect(applyTierDiscount(350, 0)).toBe(350)
  })

  it('applies a discount and rounds the result to the nearest quarter', () => {
    // 350 * (1 - 8/100) = 322 -> quarter-rounds to 325
    expect(applyTierDiscount(350, 8)).toBe(325)
  })

  it('applies a markup (negative percent) and rounds to the nearest quarter', () => {
    // 350 * (1 - (-24)/100) = 434 -> quarter-rounds to 425
    expect(applyTierDiscount(350, -24)).toBe(425)
    // 350 * (1 - (-100)/100) = 700, already a clean stop
    expect(applyTierDiscount(350, -100)).toBe(700)
  })
})

describe('formatTierAdjustment', () => {
  it('describes a positive percent as "% off"', () => {
    expect(formatTierAdjustment(8)).toBe('8% off')
  })

  it('describes a negative percent as "% markup"', () => {
    expect(formatTierAdjustment(-24)).toBe('24% markup')
  })

  it('describes zero as no adjustment', () => {
    expect(formatTierAdjustment(0)).toBe('—')
  })
})
