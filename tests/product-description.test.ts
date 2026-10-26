import { describe, expect, it } from 'vitest'
import { isNameCopyDescription, meaningfulDescription } from '../lib/product-description'
import { classifyProduct } from '../lib/cleanup'
import { productJsonLd } from '../lib/product-jsonld'
import type { Product } from '../lib/types'

const NAME = 'Heart Bear 12" - 12/pk 4bx/cs cs.48'

describe('isNameCopyDescription', () => {
  it("matches the sync's copy of the current name", () => {
    expect(isNameCopyDescription('Heart Bear 12" - 12/pk 4bx/cs cs.48/cs', NAME)).toBe(true)
    expect(isNameCopyDescription(NAME, NAME)).toBe(true)
  })

  it('matches a stale copy of an earlier name, even one that contradicts it', () => {
    expect(isNameCopyDescription('10" Pink GIft Bow - 100/pk 20bx/cs cs.20/cs', '10" Pink GIft Bow - 20/pk 100bx/cs cs.100')).toBe(true)
    expect(isNameCopyDescription('Pink Love Teddy Plush w / Lights 30cm - 12/pk 4bx/cs cs.48/cs', "Pink Plush Bear 8.7' - 12/pk 5bx/cs cs.60")).toBe(true)
  })

  it('keeps real text', () => {
    expect(isNameCopyDescription('Soft plush bear holding a red heart. Machine washable.', NAME)).toBe(false)
    expect(isNameCopyDescription('Heart bear, great for Valentine displays', NAME)).toBe(false)
  })

  it('is false for a blank description (that is "missing", not "copy")', () => {
    expect(isNameCopyDescription('  ', NAME)).toBe(false)
    expect(isNameCopyDescription(null, NAME)).toBe(false)
  })
})

describe('meaningfulDescription', () => {
  it('returns real text trimmed, and nothing for blanks or copies', () => {
    expect(meaningfulDescription('  Soft plush bear.  ', NAME)).toBe('Soft plush bear.')
    expect(meaningfulDescription(`${NAME}/cs`, NAME)).toBe('')
    expect(meaningfulDescription(null, NAME)).toBe('')
  })
})

describe('where it is used', () => {
  it('cleanup counts a name copy as no description', () => {
    const row = { name: NAME, image_url: 'x', needs_photo: false, category_id: 'c', has_category_link: true }
    expect(classifyProduct({ ...row, description: `${NAME}/cs` }).description).toBe(true)
    expect(classifyProduct({ ...row, description: 'Soft plush bear.' }).description).toBe(false)
  })

  it('structured data leaves out a name-copy description', () => {
    const p = { id: 'prod-1', sku: 'P1', name: NAME, description: `${NAME}/cs`, price_cents: 0, image_urls: [], is_active: true } as unknown as Product
    const settings = { show_price_detail: false, show_stock_detail: false, show_sku_barcode_detail: false, show_category_detail: false }
    expect(productJsonLd(p, settings)).not.toHaveProperty('description')
  })
})
