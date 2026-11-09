import { describe, expect, it } from 'vitest'
import { hiddenSearchDemand, searchedTerm } from '@/lib/hidden-search-demand'

const hidden = [
  { id: 'p1', sku: 'L842099', name: 'Lamp', barcode: '012345678905' },
  { id: 'p2', sku: 'T642158', name: 'Tray', barcode: null },
  { id: 'p3', sku: 'K229534', name: 'Kite', barcode: '' },
]
const ev = (term: string, created_at: string) => ({ term, created_at })

describe('searchedTerm', () => {
  it('strips the zero-result prefix, trims and lowercases', () => {
    expect(searchedTerm('[no_results]  L842099 ')).toBe('l842099')
    expect(searchedTerm('Squishy')).toBe('squishy')
    expect(searchedTerm(null)).toBe('')
  })
})

describe('hiddenSearchDemand', () => {
  it('counts exact SKU and barcode searches per product, most searched first', () => {
    const rows = hiddenSearchDemand(
      [
        ev('[no_results] t642158', '2026-10-01T00:00:00Z'),
        ev('[no_results] L842099', '2026-10-02T00:00:00Z'),
        ev('[no_results] 012345678905', '2026-10-05T00:00:00Z'),
        ev('[no_results] l842099', '2026-10-03T00:00:00Z'),
      ],
      hidden,
    )
    expect(rows.map((r) => [r.product.sku, r.times, r.lastSearched])).toEqual([
      ['L842099', 3, '2026-10-05T00:00:00Z'],
      ['T642158', 1, '2026-10-01T00:00:00Z'],
    ])
  })

  it('ignores partial SKUs, other words, and empty barcodes', () => {
    const rows = hiddenSearchDemand(
      [ev('[no_results] L8420', '2026-10-01T00:00:00Z'), ev('[no_results] lamp', '2026-10-01T00:00:00Z'), ev('[no_results] ', '2026-10-01T00:00:00Z')],
      hidden,
    )
    expect(rows).toEqual([])
  })
})

describe('hiddenSearchDemand with spaced SKUs', () => {
  it('matches "l 842099" to L842099, but not a spaced phrase of words', () => {
    const rows = hiddenSearchDemand(
      [
        { term: '[no_results] l 842099', created_at: '2026-11-09T18:13:00Z' },
        { term: '[no_results] L842099', created_at: '2026-11-01T00:00:00Z' },
        { term: '[no_results] lamp 842099 extra', created_at: '2026-11-02T00:00:00Z' },
      ],
      [{ id: 'p1', sku: 'L842099', name: 'Lamp', barcode: null }],
    )
    expect(rows.map((r) => [r.product.sku, r.times, r.lastSearched])).toEqual([['L842099', 2, '2026-11-09T18:13:00Z']])
  })
})
