import { describe, expect, it } from 'vitest'
import { boxesPerCase, categoryMedians, CATEGORY_MIN_SIZE, describeCasePrice, likelyCasePrice } from '../lib/price-check'

describe('boxesPerCase', () => {
  it('reads the boxes per case out of a house-standard name', () => {
    expect(boxesPerCase('Brown Floral Paper - 20/pk 60bx/cs cs.60')).toBe(60)
    expect(boxesPerCase('Bows 24 bx / cs')).toBe(24)
    expect(boxesPerCase('Hair dryer - 1/pk')).toBeNull()
  })
})

describe('likelyCasePrice', () => {
  // Real rows from 2026-10-21; floral paper's category median is $3.00.
  it('flags a whole-case price that divides back to the median', () => {
    expect(likelyCasePrice({ name: 'Floral Paper - 20/pk 60bx/cs cs.60', price_cents: 18000 }, 300)).toEqual({
      boxes: 60,
      perBoxCents: 300,
      medianCents: 300,
    })
  })

  it('leaves a normal per-pack price alone', () => {
    expect(likelyCasePrice({ name: 'Floral Paper - 20/pk 60bx/cs cs.60', price_cents: 425 }, 300)).toBeNull()
  })

  // A big gap alone is not enough: dividing by a small box count lands near
  // the median by chance.
  it('needs at least 24 boxes per case, a 20x gap, and a per-box price near the median', () => {
    expect(likelyCasePrice({ name: 'Hair dryer 20bx/cs', price_cents: 3300 }, 165)).toBeNull()
    expect(likelyCasePrice({ name: 'Paper 60bx/cs', price_cents: 5000 }, 300)).toBeNull()
    expect(likelyCasePrice({ name: 'Paper 60bx/cs', price_cents: 60000 }, 300)).toBeNull()
    expect(likelyCasePrice({ name: 'Paper, no case count', price_cents: 18000 }, 300)).toBeNull()
  })

  it('needs a median and a price', () => {
    expect(likelyCasePrice({ name: 'Paper 60bx/cs', price_cents: 18000 }, undefined)).toBeNull()
    expect(likelyCasePrice({ name: 'Paper 60bx/cs', price_cents: null }, 300)).toBeNull()
  })

  it('describes itself for the admin screens', () => {
    expect(describeCasePrice(18000, { boxes: 60, perBoxCents: 300, medianCents: 300 })).toBe(
      '$180.00 = 60 bx × $3.00; the category median is $3.00',
    )
  })
})

describe('categoryMedians', () => {
  const row = (category_id: string | null, price_cents: number | null, extra: Partial<{ manually_hidden: boolean; is_active: boolean; sku: string | null }> = {}) => ({
    sku: 'S',
    category_id,
    price_cents,
    is_active: true,
    manually_hidden: false,
    ...extra,
  })

  it('takes the median over visible, priced products only', () => {
    const rows = [
      ...Array.from({ length: CATEGORY_MIN_SIZE }, (_, i) => row('paper', 300 + i)),
      // Hidden case-priced ones must not pull their own median up.
      ...Array.from({ length: 20 }, () => row('paper', 18000, { manually_hidden: true })),
      row('paper', 0),
      row('paper', 99999, { is_active: false }),
      row('paper', 99999, { sku: null }),
      row(null, 500),
    ]
    expect(categoryMedians(rows)).toEqual(new Map([['paper', 303.5]]))
  })

  it('skips categories too small for a meaningful median', () => {
    expect(categoryMedians(Array.from({ length: CATEGORY_MIN_SIZE - 1 }, () => row('tiny', 100))).size).toBe(0)
  })
})
