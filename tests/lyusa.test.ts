import { describe, expect, it } from 'vitest'
import {
  BATCH_NAME_RE, attentionReasons, buildRow, lyusaDate, rowValues, splitIntoParts, toCsv,
  type LyusaProduct,
} from '@/lib/lyusa'

const product = (over: Partial<LyusaProduct> = {}): LyusaProduct => ({
  sku: 'F288153',
  name: 'Extra Large Bubble Balloon Ball - 1/pk 20bx/cs',
  barcode: '737879111642',
  price_cents: 500,
  case_pieces: null,
  sold_by: null,
  case_length_in: 29,
  case_width_in: 22,
  case_height_in: 16,
  case_weight_lb: 33,
  ...over,
})

describe('buildRow', () => {
  it('builds the one-figure-per-case style, sold by the piece', () => {
    const row = buildRow(product(), undefined, ['FLORAL SUP', 'FLSUP'], '10/19/2026', undefined)
    expect(row.Description).toBe('Extra Large Bubble Balloon Ball - 20/cs - 29" x 22" x 16" - 33lbs - cs.20')
    expect(row.Unit).toBe('CS20')
    expect(row['Unit/Case']).toBe('20')
    expect(row['Default Unit']).toBe('PC')
    expect(row.Price3).toBe('5')
    expect(row['Create Date']).toBe(' 10/19/2026')
    expect(row['Image Name']).toBe('Z:\\Pic\\F288153.jpg')
    expect(row['Dept#']).toBe('FLORAL SUP')
    expect(row['Class#']).toBe('FLSUP')
  })

  it('builds the pk/pk - bxpk/cs style for packs of several pieces', () => {
    const row = buildRow(
      product({ name: '3D Printed Snakes 20" - 12/pk 20bx/cs', case_length_in: 19.7, case_width_in: 16, case_height_in: 16, case_weight_lb: 23.4 }),
      undefined, ['TOYS', 'NOVEL'], '10/19/2026', undefined,
    )
    expect(row.Description).toBe('3D Printed Snakes 20" - 12/pk - 20pk/cs - case dim. 19.7" x 16" x 16" - 23.4lbs')
    expect(row.Unit).toBe('C240')
    expect(row['Default Unit']).toBe('CS')
  })

  it('falls back to supplier pieces per carton when the name has no pack spec', () => {
    const row = buildRow(
      product({ name: 'Mystery Item', barcode: null, case_weight_lb: null }),
      undefined, undefined, '10/19/2026', { pieces: 48, upc: '0123' },
    )
    expect(row.Description).toBe('Mystery Item - 48/cs - 29" x 22" x 16" - cs.48')
    expect(row.Unit).toBe('CS48')
    expect(row['UPC Code']).toBe('0123')
    expect(row['Case Wt']).toBe('0')
  })

  it('fills missing dims and weight from the template row', () => {
    const tpl = { Description: 'Thing - 10/cs - 1" x 2" x 3" - 4.5lbs', Unit: '', 'UPC Code': '999' }
    const row = buildRow(
      product({ case_length_in: null, case_weight_lb: null, barcode: null }),
      tpl, undefined, '10/19/2026', undefined,
    )
    expect(row.Description).toContain('1" x 2" x 3" - 4.5lbs')
    expect(row['Case Wt']).toBe('4.5')
    expect(row['UPC Code']).toBe('999')
  })
})

describe('rowValues / toCsv', () => {
  it('keeps template order and fills constant columns from the filler row', () => {
    const vals = rowValues(['Item#', 'WHS#', 'Note1'], { 'Item#': 'A1' }, { 'Item#': 'X', 'WHS#': '01' })
    expect(vals).toEqual(['A1', '01', ''])
  })

  it('writes BOM, CRLF and quotes every field, doubling inner quotes', () => {
    expect(toCsv([['a', '29" x 22"'], ['b', '']])).toBe('\uFEFF"a","29"" x 22"""\r\n"b",""\r\n')
  })
})

describe('attentionReasons', () => {
  it('flags missing code, pack size, weight and photo', () => {
    expect(attentionReasons({ 'Class#': '', Unit: '', 'Case Wt': '0' }, false)).toEqual([
      'no Class#/Dept#', 'no pack size (Unit blank)', 'no case weight', 'no photo',
    ])
    expect(attentionReasons({ 'Class#': 'X', Unit: 'CS1', 'Case Wt': '2' }, true)).toEqual([])
  })
})

describe('splitIntoParts', () => {
  it('starts a new part before going over the limit', () => {
    const files = [5, 5, 5, 3, 12, 1].map((size, i) => ({ i, size }))
    expect(splitIntoParts(files, 10).map((p) => p.map((f) => f.i))).toEqual([[0, 1], [2, 3], [4], [5]])
  })

  it('returns no parts for no files', () => {
    expect(splitIntoParts([], 10)).toEqual([])
  })
})

describe('BATCH_NAME_RE / lyusaDate', () => {
  it('accepts dated names and rejects path tricks', () => {
    expect(BATCH_NAME_RE.test('2026-10-19')).toBe(true)
    expect(BATCH_NAME_RE.test('2026-10-15-ALL21')).toBe(true)
    expect(BATCH_NAME_RE.test('../x')).toBe(false)
    expect(BATCH_NAME_RE.test('a/b')).toBe(false)
  })

  it('formats M/D/YYYY without padding', () => {
    expect(lyusaDate(new Date(2026, 0, 5))).toBe('1/5/2026')
  })
})
