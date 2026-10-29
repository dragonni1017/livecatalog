import { describe, it, expect } from 'vitest'
import { isOnPriceGrid, parseDollars, parseReviewBody } from '@/lib/price-review'

describe('isOnPriceGrid (.00, .25, .50, never .75)', () => {
  it('accepts grid prices and rejects the rest', () => {
    expect(isOnPriceGrid(950)).toBe(true)
    expect(isOnPriceGrid(1325)).toBe(true)
    expect(isOnPriceGrid(1200)).toBe(true)
    expect(isOnPriceGrid(1275)).toBe(false)
    expect(isOnPriceGrid(1210)).toBe(false)
    expect(isOnPriceGrid(0)).toBe(false)
    expect(isOnPriceGrid(12.5)).toBe(false)
  })
})

describe('parseDollars', () => {
  it('reads plain and $ amounts', () => {
    expect(parseDollars('12.5')).toBe(1250)
    expect(parseDollars('$9.50')).toBe(950)
    expect(parseDollars(' 13 ')).toBe(1300)
  })
  it('rejects junk', () => {
    expect(parseDollars('')).toBeNull()
    expect(parseDollars('abc')).toBeNull()
    expect(parseDollars('1.234')).toBeNull()
    expect(parseDollars('-5')).toBeNull()
  })
})

describe('parseReviewBody', () => {
  it('reads approve, skip and reopen', () => {
    expect(parseReviewBody({ id: 'a', action: 'approve', cents: 950 })).toEqual({ id: 'a', action: 'approve', cents: 950 })
    expect(parseReviewBody({ id: 'a', action: 'skip' })).toEqual({ id: 'a', action: 'skip' })
    expect(parseReviewBody({ id: 'a', action: 'reopen' })).toEqual({ id: 'a', action: 'reopen' })
  })

  it('rejects an off-grid price and suggests the nearest', () => {
    const r = parseReviewBody({ id: 'a', action: 'approve', cents: 1275 })
    expect(r).toHaveProperty('error')
    // .75 is exactly between .50 and the next dollar; the site's rounding takes .50.
    expect((r as { error: string }).error).toContain('$12.50')
  })

  it('rejects missing id, bad action and missing price', () => {
    expect(parseReviewBody({ action: 'skip' })).toHaveProperty('error')
    expect(parseReviewBody({ id: 'a', action: 'delete' })).toHaveProperty('error')
    expect(parseReviewBody({ id: 'a', action: 'approve' })).toHaveProperty('error')
    expect(parseReviewBody({ id: 'a', action: 'approve', cents: 0 })).toHaveProperty('error')
  })
})
