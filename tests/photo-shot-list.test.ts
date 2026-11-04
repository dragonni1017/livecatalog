import { describe, expect, it } from 'vitest'
import { needsPhoto, rankShotList, shotReasons, type ShotListInput } from '@/lib/photo-shot-list'

const NOW = new Date('2026-11-04T12:00:00Z')
let n = 0
const p = (o: Partial<ShotListInput>): ShotListInput => ({
  id: `p${++n}`,
  sku: `S${n}`,
  name: 'Plain Mug',
  image_url: null,
  needs_photo: null,
  is_active: true,
  manually_hidden: true,
  stock_qty: 10,
  price_cents: 500,
  arrived_at: '2026-09-01T00:00:00Z',
  category_id: null,
  ...o,
})

describe('needsPhoto', () => {
  it('matches the Cleanup rule', () => {
    expect(needsPhoto({ image_url: null, needs_photo: null })).toBe(true)
    expect(needsPhoto({ image_url: '  ', needs_photo: false })).toBe(true)
    expect(needsPhoto({ image_url: 'https://x/y.jpg', needs_photo: true })).toBe(true)
    expect(needsPhoto({ image_url: 'https://x/y.jpg', needs_photo: false })).toBe(false)
  })
})

describe('rankShotList', () => {
  it('keeps only active, in-stock products with a SKU that need a photo', () => {
    const rows = rankShotList(
      [
        p({ sku: 'KEEP' }),
        p({ image_url: 'https://x/a.jpg' }),
        p({ is_active: false }),
        p({ stock_qty: 0 }),
        p({ sku: ' ' }),
      ],
      new Map(),
      NOW,
    )
    expect(rows.map((r) => r.product.sku)).toEqual(['KEEP'])
  })

  it('orders: holiday soon, then searched, then rest; a season just over goes last', () => {
    const products = [
      p({ sku: 'PLAIN-NEW', arrived_at: '2026-10-30T00:00:00Z' }),
      p({ sku: 'HALLOWEEN', name: 'Halloween Pumpkin Bucket' }),
      p({ sku: 'SEARCHED-2', id: 's2' }),
      p({ sku: 'CHRISTMAS', name: 'Christmas Tree Ornament' }),
      p({ sku: 'SEARCHED-5', id: 's5' }),
      p({ sku: 'PLAIN-OLD', arrived_at: '2026-08-01T00:00:00Z' }),
      p({ sku: 'ZERO-NEW', price_cents: 0, arrived_at: '2026-11-01T00:00:00Z' }),
    ]
    const rows = rankShotList(products, new Map([['s2', 2], ['s5', 5]]), NOW)
    expect(rows.map((r) => r.product.sku)).toEqual([
      'CHRISTMAS',
      'SEARCHED-5',
      'SEARCHED-2',
      'PLAIN-NEW',
      'PLAIN-OLD',
      'ZERO-NEW',
      'HALLOWEEN',
    ])
  })

  it('breaks ties on stock, then SKU', () => {
    const rows = rankShotList([p({ sku: 'B', stock_qty: 5 }), p({ sku: 'A', stock_qty: 5 }), p({ sku: 'C', stock_qty: 50 })], new Map(), NOW)
    expect(rows.map((r) => r.product.sku)).toEqual(['C', 'A', 'B'])
  })
})

describe('shotReasons', () => {
  it('explains each row', () => {
    const [xmas] = rankShotList([p({ name: 'Christmas Tree Ornament', id: 'x' })], new Map([['x', 3]]), NOW)
    expect(shotReasons(xmas)).toEqual(['Christmas in 51 days', 'searched 3×'])
    const [reshoot] = rankShotList([p({ image_url: 'https://x/a.jpg', needs_photo: true, price_cents: 0 })], new Map(), NOW)
    expect(shotReasons(reshoot)).toEqual(['new photo wanted', '$0: stays hidden until priced'])
  })
})
