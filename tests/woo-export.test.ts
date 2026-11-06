import { describe, expect, it } from 'vitest'
import { buildExport, missingFor, shortDescription, toCsv, wooHeader, wooRow, type ExportProduct } from '@/lib/woo-export'

const p = (o: Partial<ExportProduct> = {}): ExportProduct => ({
  id: 'p1',
  sku: 'A1',
  name: 'Bear Plush - 12/pk 10bx/cs cs.120',
  description: 'Soft brown bear plush with a red bow. About 10" tall.',
  image_url: 'https://res.cloudinary.com/x/image/upload/A1.jpg',
  image_urls: ['https://res.cloudinary.com/x/image/upload/A1.jpg', 'https://res.cloudinary.com/x/image/upload/A1-2.jpg'],
  needs_photo: false,
  price_cents: 350,
  stock_qty: 10,
  is_active: true,
  manually_hidden: false,
  category_id: 'c1',
  ...o,
})
const none = { images: false, categories: false }

describe('missingFor', () => {
  it('is empty for a complete, shown product', () => {
    expect(missingFor(p(), 'Plush')).toEqual([])
  })
  it('lists every gap, in order', () => {
    expect(missingFor(p({ image_url: null, price_cents: 0, description: 'Bear Plush', manually_hidden: true }), null)).toEqual([
      'photo', 'price', 'category', 'description', 'hidden on purpose',
    ])
    expect(missingFor(p({ needs_photo: true }), 'Plush')).toEqual(['photo'])
  })
})

describe('shortDescription', () => {
  it('takes the first sentence', () => {
    expect(shortDescription('Soft brown bear plush with a red bow. About 10" tall.')).toBe('Soft brown bear plush with a red bow.')
  })
  it('keeps short text and trims long text at a word', () => {
    expect(shortDescription('Red bow')).toBe('Red bow')
    const long = 'word '.repeat(60).trim()
    const s = shortDescription(long)
    expect(s.length).toBeLessThanOrEqual(198)
    expect(s.endsWith('…')).toBe(true)
  })
})

describe('wooRow / wooHeader', () => {
  it('uses WooCommerce column names and escapes HTML', () => {
    expect(wooHeader(none)).toEqual(['SKU', 'Published', 'Visibility in catalog', 'Short description', 'Description'])
    expect(wooRow(p({ description: 'Tom & Jerry <set>' }), 'Plush', none)).toEqual(['A1', '1', 'visible', 'Tom & Jerry <set>', '<p>Tom &amp; Jerry &lt;set&gt;</p>'])
  })
  it('adds categories (commas escaped) and all images when asked', () => {
    const o = { images: true, categories: true }
    expect(wooHeader(o).slice(-2)).toEqual(['Categories', 'Images'])
    const r = wooRow(p(), 'Bows, Ribbons', o)
    expect(r.slice(-2)).toEqual(['Bows\\, Ribbons', 'https://res.cloudinary.com/x/image/upload/A1.jpg, https://res.cloudinary.com/x/image/upload/A1-2.jpg'])
  })
})

describe('buildExport', () => {
  it('splits ready from almost, skips inactive and SKU-less, and orders almost by fewest gaps', () => {
    const { ready, almost } = buildExport(
      [
        p({ id: '1', sku: 'B2' }),
        p({ id: '2', sku: 'A1' }),
        p({ id: '3', sku: 'C3', price_cents: 0, image_url: null, stock_qty: 99 }),
        p({ id: '4', sku: 'D4', price_cents: 0, stock_qty: 5 }),
        p({ id: '5', sku: 'E5', is_active: false }),
        p({ id: '6', sku: '' }),
      ],
      () => 'Plush',
      none,
    )
    expect(ready.map((r) => r[0])).toEqual(['A1', 'B2'])
    expect(almost.map((a) => [a.sku, a.missing])).toEqual([['D4', ['price']], ['C3', ['photo', 'price']]])
  })
})

describe('toCsv', () => {
  it('quotes commas, quotes and newlines, with a BOM and CRLF', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'say "hi"\nok']])).toBe('﻿a,b\r\n"x,y","say ""hi""\nok"\r\n')
  })
})
