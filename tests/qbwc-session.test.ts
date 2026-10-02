import { describe, expect, it } from 'vitest'
import { isQbwcSessionLive, QBWC_SESSION_MAX_AGE_MS } from '../lib/qbwc-session'

const now = Date.parse('2026-10-02T12:00:00Z')
const openedAgo = (ms: number) => new Date(now - ms).toISOString()

describe('isQbwcSessionLive', () => {
  it('accepts an open session inside the window, including a long real run', () => {
    expect(isQbwcSessionLive({ opened_at: openedAgo(6_000), closed_at: null }, now)).toBe(true)
    expect(isQbwcSessionLive({ opened_at: openedAgo(3 * 60_000), closed_at: null }, now)).toBe(true)
    expect(isQbwcSessionLive({ opened_at: openedAgo(QBWC_SESSION_MAX_AGE_MS), closed_at: null }, now)).toBe(true)
  })

  it('rejects a closed session, however recent', () => {
    expect(isQbwcSessionLive({ opened_at: openedAgo(1_000), closed_at: openedAgo(500) }, now)).toBe(false)
  })

  it('rejects a never-closed session once it is past the window', () => {
    expect(isQbwcSessionLive({ opened_at: openedAgo(QBWC_SESSION_MAX_AGE_MS + 1), closed_at: null }, now)).toBe(false)
    expect(isQbwcSessionLive({ opened_at: '2026-08-01T00:00:00Z', closed_at: null }, now)).toBe(false)
  })

  it('rejects an unparseable opened_at', () => {
    expect(isQbwcSessionLive({ opened_at: 'not a date', closed_at: null }, now)).toBe(false)
  })
})
