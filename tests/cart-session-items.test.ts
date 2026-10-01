import { describe, expect, it } from 'vitest'
import { MAX_CART_ITEMS, MAX_ITEM_QTY, parseRequestedItems, sanitizeGreetingName } from '../lib/cart-session-items'

describe('parseRequestedItems', () => {
  it('keeps only sku and qty, dropping caller-supplied name and price', () => {
    const out = parseRequestedItems([{ sku: 'F284020', qty: 2, name: 'Click https://evil.example', priceCents: 1 }])
    expect(out).toEqual([{ sku: 'F284020', qty: 2 }])
  })

  it('rejects malformed rows and out-of-range quantities', () => {
    const out = parseRequestedItems([
      null,
      'F1',
      { sku: 'A', qty: 0 },
      { sku: 'B', qty: 1.5 },
      { sku: 'C', qty: MAX_ITEM_QTY + 1 },
      { sku: 'D', qty: '3' },
      { sku: '', qty: 1 },
      { sku: 'x'.repeat(65), qty: 1 },
      { sku: ' OK ', qty: 1 },
    ])
    expect(out).toEqual([{ sku: 'OK', qty: 1 }])
  })

  it('merges duplicate SKUs and caps the item count', () => {
    expect(parseRequestedItems([{ sku: 'A', qty: 1 }, { sku: 'A', qty: 2 }])).toEqual([{ sku: 'A', qty: 3 }])
    const many = Array.from({ length: MAX_CART_ITEMS + 50 }, (_, i) => ({ sku: `S${i}`, qty: 1 }))
    expect(parseRequestedItems(many)).toHaveLength(MAX_CART_ITEMS)
  })

  it('returns nothing for a non-array', () => {
    expect(parseRequestedItems({ sku: 'A', qty: 1 })).toEqual([])
  })
})

describe('sanitizeGreetingName', () => {
  it('keeps ordinary names, including accents and other scripts', () => {
    expect(sanitizeGreetingName("Mary-Jane O'Neil")).toBe("Mary-Jane O'Neil")
    expect(sanitizeGreetingName('José Ñúñez')).toBe('José Ñúñez')
    expect(sanitizeGreetingName('王小明')).toBe('王小明')
  })

  it('cannot carry a link, an address or a multi-line message', () => {
    const out = sanitizeGreetingName('Bob\n\nYour account is locked: visit evil.com/login or mail x@y.co 555-0100')
    expect(out).not.toMatch(/[.\/@:\d\n]/)
    expect(out).not.toContain('evil.com')
  })

  it('caps length and returns null when nothing usable is left', () => {
    expect(sanitizeGreetingName('a'.repeat(500))!.length).toBeLessThanOrEqual(60)
    expect(sanitizeGreetingName('https://...')).toBe('https')
    expect(sanitizeGreetingName('123 456')).toBeNull()
    expect(sanitizeGreetingName(42)).toBeNull()
  })
})
