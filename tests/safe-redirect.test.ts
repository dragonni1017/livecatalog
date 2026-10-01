import { describe, expect, it } from 'vitest'
import { safeInternalPath } from '../lib/safe-redirect'

describe('safeInternalPath', () => {
  it('keeps ordinary same-site paths, with query and hash', () => {
    expect(safeInternalPath('/account')).toBe('/account')
    expect(safeInternalPath('/order/ORD-2026-0032?t=abc')).toBe('/order/ORD-2026-0032?t=abc')
    expect(safeInternalPath('/category/plush#top')).toBe('/category/plush#top')
  })

  it.each([
    '@evil.com',
    '.evil.com',
    'evil.com',
    'https://evil.com',
    '//evil.com',
    '///evil.com',
    '/\\evil.com',
    '/\\/evil.com',
    '/\t/evil.com',
    '/\n/evil.com',
    'javascript:alert(1)',
    '',
  ])('falls back for %j', (raw) => {
    expect(safeInternalPath(raw, '/account')).toBe('/account')
  })

  it('falls back for non-strings', () => {
    expect(safeInternalPath(null)).toBe('/')
    expect(safeInternalPath(undefined, '/x')).toBe('/x')
    expect(safeInternalPath(42)).toBe('/')
  })

  it('never builds an off-site URL when appended to an origin', () => {
    for (const raw of ['@evil.com', '//evil.com', '/\\evil.com']) {
      const dest = new URL(`https://lyusa.app${safeInternalPath(raw, '/account')}`)
      expect(dest.host).toBe('lyusa.app')
    }
  })
})
