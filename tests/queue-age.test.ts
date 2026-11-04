import { describe, expect, it } from 'vitest'
import { lastSeen, queueAge } from '@/lib/queue-age'

// 2026-11-04 is a Wednesday. Times are UTC; days are counted in Los Angeles.
const NOW = '2026-11-04T20:00:00Z'

describe('queueAge', () => {
  it('uses the oldest pending item', () => {
    // Oct 29 (Thu) -> Nov 4 (Wed): 6 calendar days, 4 business days.
    expect(queueAge(['2026-11-03T20:00:00Z', '2026-10-29T20:00:00Z', null], NOW)).toEqual({
      text: 'oldest waiting 6 days',
      stale: false,
    })
  })
  it('is stale after a full work week', () => {
    // Oct 28 (Wed) -> Nov 4 (Wed): 5 business days.
    expect(queueAge(['2026-10-28T20:00:00Z'], NOW)).toEqual({ text: 'oldest waiting 7 days', stale: true })
  })
  it('is not stale inside a work week', () => {
    expect(queueAge(['2026-11-02T20:00:00Z'], NOW)).toEqual({ text: 'oldest waiting 2 days', stale: false })
    expect(queueAge(['2026-11-03T20:00:00Z'], NOW)).toEqual({ text: 'oldest waiting 1 day', stale: false })
  })
  it('says "added today" for today, in Los Angeles time', () => {
    // 07:00 UTC on Nov 4 is still Nov 3 in Los Angeles.
    expect(queueAge(['2026-11-04T16:00:00Z'], NOW)?.text).toBe('added today')
    expect(queueAge(['2026-11-04T07:00:00Z'], NOW)?.text).toBe('oldest waiting 1 day')
  })
  it('is null with nothing valid', () => {
    expect(queueAge([], NOW)).toBeNull()
    expect(queueAge([null, undefined, 'not a date'], NOW)).toBeNull()
  })
})

describe('lastSeen', () => {
  it('describes the newest timestamp', () => {
    expect(lastSeen(['2026-10-01T00:00:00Z', '2026-11-04T18:00:00Z'], NOW)).toBe('today')
    expect(lastSeen(['2026-11-03T18:00:00Z'], NOW)).toBe('yesterday')
    expect(lastSeen(['2026-10-31T18:00:00Z'], NOW)).toBe('4 days ago')
    expect(lastSeen([], NOW)).toBeNull()
  })
})
