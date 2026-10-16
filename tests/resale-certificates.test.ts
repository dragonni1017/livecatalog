import { afterEach, describe, expect, it, vi } from 'vitest'
import { certStatusLabel, isExpired, RESALE_CERT_TYPES, US_STATES } from '../lib/resale-certificates'

afterEach(() => vi.useRealTimers())

describe('isExpired', () => {
  it('compares the date against today (UTC)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-16T12:00:00Z'))
    expect(isExpired({ expires_on: '2026-10-15' })).toBe(true)
    expect(isExpired({ expires_on: '2026-10-16' })).toBe(false) // valid through its last day
    expect(isExpired({ expires_on: '2027-01-01' })).toBe(false)
  })
  it('never expires without a date', () => {
    expect(isExpired({ expires_on: null })).toBe(false)
  })
})

describe('certStatusLabel', () => {
  it('maps each status', () => {
    expect(certStatusLabel({ status: 'pending', expires_on: null })).toBe('Pending review')
    expect(certStatusLabel({ status: 'verified', expires_on: null })).toBe('Verified')
    expect(certStatusLabel({ status: 'rejected', expires_on: null })).toBe('Rejected')
  })
  it('shows Expired over any status once the date has passed', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-16T12:00:00Z'))
    expect(certStatusLabel({ status: 'verified', expires_on: '2026-01-01' })).toBe('Expired')
  })
})

describe('constants the route and bucket depend on', () => {
  it('only allows PDF, JPEG and PNG (matches the bucket allowed_mime_types)', () => {
    expect(new Set(Object.values(RESALE_CERT_TYPES))).toEqual(new Set(['application/pdf', 'image/jpeg', 'image/png']))
  })
  it('state codes are two uppercase letters (matches the table check)', () => {
    for (const s of US_STATES) expect(s).toMatch(/^[A-Z]{2}$/)
    expect(US_STATES).toContain('CA')
    expect(US_STATES).toContain('DC')
  })
})
