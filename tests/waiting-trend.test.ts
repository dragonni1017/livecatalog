import { describe, expect, it } from 'vitest'
import { pickBaseline, queueTrend, type SnapshotRow } from '@/lib/waiting-trend'

const row = (day: string, queue: string, count: number): SnapshotRow => ({ day, queue, count })

describe('pickBaseline', () => {
  it('is null with no earlier day', () => {
    expect(pickBaseline([], '2026-11-16')).toBeNull()
    expect(pickBaseline([row('2026-11-16', 'quotes', 3)], '2026-11-16')).toBeNull()
  })

  it('uses the newest day at least a week old', () => {
    const b = pickBaseline(
      [row('2026-11-02', 'quotes', 30), row('2026-11-09', 'quotes', 25), row('2026-11-12', 'quotes', 20)],
      '2026-11-16',
    )
    expect(b?.day).toBe('2026-11-09')
    expect(b?.weekAgo).toBe(true)
    expect(b?.counts.get('quotes')).toBe(25)
  })

  it('falls back to the oldest earlier day in the first week', () => {
    const b = pickBaseline([row('2026-11-10', 'quotes', 25), row('2026-11-12', 'quotes', 20)], '2026-11-13')
    expect(b?.day).toBe('2026-11-10')
    expect(b?.weekAgo).toBe(false)
  })
})

describe('queueTrend', () => {
  const weekAgo = pickBaseline([row('2026-11-09', 'quotes', 25), row('2026-11-09', 'names', 120)], '2026-11-16')

  it('shows a drop, a rise and no change', () => {
    expect(queueTrend('quotes', 20, weekAgo)).toEqual({ change: -5, text: '▼ 5 since last week', direction: 'down' })
    expect(queueTrend('names', 124, weekAgo)).toEqual({ change: 4, text: '▲ 4 since last week', direction: 'up' })
    expect(queueTrend('names', 120, weekAgo)?.text).toBe('no change since last week')
  })

  it('counts a queue missing from the saved day as 0 then', () => {
    expect(queueTrend('credit', 2, weekAgo)?.text).toBe('▲ 2 since last week')
  })

  it('names the date before a week of history exists', () => {
    const early = pickBaseline([row('2026-11-09', 'quotes', 25)], '2026-11-12')
    expect(queueTrend('quotes', 22, early)?.text).toBe('▼ 3 since Nov 9')
  })

  it('is null without a baseline', () => {
    expect(queueTrend('quotes', 3, null)).toBeNull()
  })
})
