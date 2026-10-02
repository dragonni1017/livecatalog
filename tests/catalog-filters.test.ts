import { describe, expect, it } from 'vitest'
import { CASE_SIZES, casePiecesFor, parseCaseSize, parseSoldBy, soldByFor } from '@/lib/catalog-filters'

// Mirrors supabase/migrations/0054 (product_case_pieces / product_sold_by).
// If either side changes, change both.
describe('casePiecesFor', () => {
  it('is pieces per pack × packs per case, whichever convention', () => {
    expect(casePiecesFor('Foam Bear with Heart 7cm - 12/pk 10bx/cs cs.120')).toBe(120) // piece-sold
    expect(casePiecesFor('10" Gold Gift Bow - 20/pk 100bx/cs cs.100')).toBe(2000) // pack-sold: cs.N counts packs
    expect(casePiecesFor('Happy Face Graduation Pen - 12/pk 50bx/cs cs.50pk')).toBe(600)
    expect(casePiecesFor('Teddy Bear Fur Pen Giant - 12/pk 24bx/cs')).toBe(288) // no cs.N
  })
  it('is null without a pack spec', () => {
    expect(casePiecesFor('Pink Solid Wrapping Paper')).toBeNull()
    expect(casePiecesFor('Punch The Monkey Plush - 24/cs')).toBeNull()
  })
})

describe('soldByFor', () => {
  it('reads the convention from the shape, as packSpecConvention does', () => {
    expect(soldByFor('Foam Bear with Heart 7cm - 12/pk 10bx/cs cs.120')).toBe('piece')
    expect(soldByFor('10" Gold Gift Bow - 20/pk 100bx/cs cs.100')).toBe('pack')
    expect(soldByFor('Cutie Cow Sitting Plush 45cm - 1/pk 24bx/cs cs.24')).toBe('piece') // pk = 1
  })
  it('lets a stated unit decide, with no fallback', () => {
    expect(soldByFor('Happy Face Graduation Pen - 12/pk 50bx/cs cs.50pk')).toBe('pack')
    expect(soldByFor('Safari Pen - 12/pk 50bx/cs cs.600pcs')).toBe('piece')
    expect(soldByFor('Mismatch - 12/pk 50bx/cs cs.600pk')).toBeNull()
  })
  it('is null for no spec, or one that fits neither convention', () => {
    expect(soldByFor('Pink Solid Wrapping Paper')).toBeNull()
    expect(soldByFor('Odd - 12/pk 10bx/cs cs.77')).toBeNull()
  })
})

describe('URL params', () => {
  it('accepts only known values', () => {
    expect(parseSoldBy('piece')).toBe('piece')
    expect(parseSoldBy('PACK')).toBeNull()
    expect(parseSoldBy(undefined)).toBeNull()
    expect(parseCaseSize('large')?.min).toBe(101)
    expect(parseCaseSize('huge')).toBeNull()
  })
  it('case-size groups tile the range with no gaps or overlaps', () => {
    for (let i = 1; i < CASE_SIZES.length; i++) {
      expect(CASE_SIZES[i].min).toBe((CASE_SIZES[i - 1].max as number) + 1)
    }
  })
})
