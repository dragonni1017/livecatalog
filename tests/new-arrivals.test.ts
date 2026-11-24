import { describe, expect, it } from 'vitest'
import { NEW_ARRIVAL_DAYS, fallbackSinceMs, formatArrivalDate, newArrivalsSinceMs } from '@/lib/new-arrivals'

describe('newArrivalsSinceMs', () => {
  it('starts the window NEW_ARRIVAL_DAYS before now', () => {
    const now = Date.parse('2026-10-19T12:00:00Z')
    expect(NEW_ARRIVAL_DAYS).toBe(30)
    expect(new Date(newArrivalsSinceMs(now)).toISOString()).toBe('2026-09-19T12:00:00.000Z')
  })
})

describe('fallbackSinceMs', () => {
  it('ends the fallback window at the newest arrival', () => {
    expect(new Date(fallbackSinceMs('2026-09-23T22:43:06.296Z')).toISOString()).toBe('2026-08-24T22:43:06.296Z')
  })
})

describe('formatArrivalDate', () => {
  it('formats in Pacific time, so a late-evening UTC timestamp keeps its local date', () => {
    expect(formatArrivalDate('2026-09-23T22:43:06Z')).toBe('September 23, 2026')
    expect(formatArrivalDate('2026-09-24T03:00:00Z')).toBe('September 23, 2026')
  })
})
