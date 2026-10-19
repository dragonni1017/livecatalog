import { describe, expect, it } from 'vitest'
import { NEW_ARRIVAL_DAYS, newArrivalsSinceMs } from '@/lib/new-arrivals'

describe('newArrivalsSinceMs', () => {
  it('starts the window NEW_ARRIVAL_DAYS before now', () => {
    const now = Date.parse('2026-10-19T12:00:00Z')
    expect(NEW_ARRIVAL_DAYS).toBe(30)
    expect(new Date(newArrivalsSinceMs(now)).toISOString()).toBe('2026-09-19T12:00:00.000Z')
  })
})
