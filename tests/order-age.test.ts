import { describe, it, expect } from 'vitest'
import { businessDaysBetween, calendarDaysBetween, isWaiting, pacificDate, summarizeWaiting, waitAge, waitLevel } from '@/lib/order-age'

describe('businessDaysBetween', () => {
  // 2026-10-23 is a Friday, 2026-10-26 a Monday.
  it('counts weekdays after the start, up to and including the end', () => {
    expect(businessDaysBetween('2026-10-26', '2026-10-26')).toBe(0)
    expect(businessDaysBetween('2026-10-26', '2026-10-27')).toBe(1)
    expect(businessDaysBetween('2026-10-23', '2026-10-26')).toBe(1) // Fri -> Mon
    expect(businessDaysBetween('2026-10-24', '2026-10-25')).toBe(0) // Sat -> Sun
    expect(businessDaysBetween('2026-10-19', '2026-10-26')).toBe(5) // a full week
  })

  it('is 0 when the end is before the start', () => {
    expect(businessDaysBetween('2026-10-27', '2026-10-26')).toBe(0)
    expect(calendarDaysBetween('2026-10-27', '2026-10-26')).toBe(0)
  })
})

describe('waitLevel (amber after 1 business day, red after 3)', () => {
  it('maps business days to a level', () => {
    expect(waitLevel(0)).toBe('fresh')
    expect(waitLevel(1)).toBe('amber')
    expect(waitLevel(2)).toBe('amber')
    expect(waitLevel(3)).toBe('red')
    expect(waitLevel(40)).toBe('red')
  })
})

describe('pacificDate / waitAge', () => {
  it('uses the Los Angeles date, not the UTC one', () => {
    // 03:00 UTC on the 27th is still the evening of the 26th in LA.
    expect(pacificDate('2026-10-27T03:00:00Z')).toBe('2026-10-26')
  })

  it('an order from Friday evening LA is 1 business day old on Monday', () => {
    const a = waitAge('2026-10-24T02:00:00Z', '2026-10-26T17:00:00Z') // Fri 19:00 PDT -> Mon 10:00 PDT
    expect(a).toEqual({ calendarDays: 3, businessDays: 1, level: 'amber' })
  })
})

describe('isWaiting / summarizeWaiting', () => {
  const now = '2026-10-29T18:00:00Z'
  const orders = [
    { status: 'new', dismissed_at: null, created_at: '2026-10-25T18:00:00Z', subtotal_cents: 6750 },
    { status: 'new', dismissed_at: null, created_at: '2026-09-21T18:00:00Z', subtotal_cents: 10000 },
    { status: 'new', dismissed_at: '2026-10-29T00:00:00Z', created_at: '2026-06-23T18:00:00Z', subtotal_cents: 15502 },
    { status: 'contacted', dismissed_at: null, created_at: '2026-05-01T18:00:00Z', subtotal_cents: 99999 },
  ]

  it('waiting means new and not dismissed', () => {
    expect(orders.map(isWaiting)).toEqual([true, true, false, false])
  })

  it('counts, finds the oldest and totals only waiting orders', () => {
    expect(summarizeWaiting(orders, now)).toEqual({ count: 2, oldestCalendarDays: 38, totalCents: 16750 })
  })
})
