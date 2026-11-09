import { describe, expect, it } from 'vitest'
import { blockedFieldReason, isQuoteBlockReason, QUOTE_BLOCK_LABELS, QUOTE_BLOCK_REASONS } from '@/lib/quote-form-events'

describe('blockedFieldReason', () => {
  it('maps the quote form labels', () => {
    expect(blockedFieldReason('Name *', false)).toBe('missing_name')
    expect(blockedFieldReason('Email *', false)).toBe('missing_email')
    expect(blockedFieldReason('Email *', true)).toBe('invalid_email')
    expect(blockedFieldReason('Ship to — address *', false)).toBe('missing_street')
    expect(blockedFieldReason('City *', false)).toBe('missing_city')
    expect(blockedFieldReason('State *', false)).toBe('missing_state')
    expect(blockedFieldReason('ZIP *', false)).toBe('missing_zip')
    expect(blockedFieldReason('', false)).toBe('missing_other')
  })
  it('every reason has a label and passes the guard; nothing else does', () => {
    for (const r of QUOTE_BLOCK_REASONS) {
      expect(QUOTE_BLOCK_LABELS[r]).toBeTruthy()
      expect(isQuoteBlockReason(r)).toBe(true)
    }
    expect(isQuoteBlockReason('qr')).toBe(false)
    expect(isQuoteBlockReason(undefined)).toBe(false)
    // analytics_events.source check (migration 0062): ^[a-z_]{1,32}$
    for (const r of QUOTE_BLOCK_REASONS) expect(r).toMatch(/^[a-z_]{1,32}$/)
  })
})
