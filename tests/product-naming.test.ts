import { describe, it, expect } from 'vitest'
import {
  auditProductName,
  buildProductName,
  formatPackSpec,
  normalizeDescriptor,
  packSpecConvention,
  parseProductName,
} from '@/lib/product-naming'

describe('formatPackSpec', () => {
  it('always writes cs.N as pieces per case', () => {
    expect(formatPackSpec(12, 10)).toBe('12/pk 10bx/cs cs.120')
    expect(formatPackSpec(15, 3)).toBe('15/pk 3bx/cs cs.45')
  })
})

describe('parseProductName', () => {
  it('splits a compliant name into base and spec', () => {
    const { base, spec } = parseProductName('Foam Bear with Heart 7cm - 12/pk 10bx/cs cs.120')
    expect(base).toBe('Foam Bear with Heart 7cm')
    expect(spec).toEqual({ piecesPerPack: 12, boxesPerCase: 10, piecesPerCase: 120 })
  })

  it('reads a name with no cs.N, implying the total from the invariant', () => {
    expect(parseProductName('1.5M 3D Chinese Dragon - 1/pk 1bx/cs').spec).toEqual({
      piecesPerPack: 1,
      boxesPerCase: 1,
      piecesPerCase: 1,
    })
  })

  it('returns a null spec for a bare name', () => {
    expect(parseProductName('Pizza Squishy')).toEqual({ base: 'Pizza Squishy', spec: null })
  })

  it('keeps a hyphen inside the descriptor itself', () => {
    const { base, spec } = parseProductName('Flower Decorative 6-in-1 Set 25cm - 12/pk 5bx/cs cs.60')
    expect(base).toBe('Flower Decorative 6-in-1 Set 25cm')
    expect(spec?.piecesPerCase).toBe(60)
  })
})

describe('normalizeDescriptor', () => {
  // The supplier invoice's phrasing is the input Phase 2 would start from.
  it('rewrites invoice phrasing into house shape', () => {
    expect(normalizeDescriptor('Party Crown Tiara Style 15cm - 100% Zinc Alloy')).toBe('Party Crown Tiara 15cm')
    expect(normalizeDescriptor('Squeeze Toy Giant Drumstick Style - 100%TPR')).toBe('Squeeze Toy Giant Drumstick')
    expect(normalizeDescriptor('Flower Decorative 3-in1  Cylinder Blank Style - 100% Paperboard')).toBe(
      'Flower Decorative 3-in1 Cylinder Blank',
    )
  })

  it('drops the legacy leading-SKU-digits prefix', () => {
    expect(normalizeDescriptor('7491 - Magic Gold Heart Ribbon Gift Box')).toBe('Magic Gold Heart Ribbon Gift Box')
  })
})

describe('buildProductName', () => {
  it('assembles descriptor, size and spec', () => {
    expect(
      buildProductName({ descriptor: 'Party Crown Tiara', size: '15cm', piecesPerPack: 144, boxesPerCase: 10 }),
    ).toBe('Party Crown Tiara 15cm - 144/pk 10bx/cs cs.1440')
  })

  it('omits the size when there isn\'t one', () => {
    expect(buildProductName({ descriptor: 'Pizza Squishy', piecesPerPack: 12, boxesPerCase: 8 })).toBe(
      'Pizza Squishy - 12/pk 8bx/cs cs.96',
    )
  })
})

describe('auditProductName', () => {
  it('passes a compliant name', () => {
    expect(auditProductName('Foam Bear with Heart 7cm - 12/pk 10bx/cs cs.120').issues).toEqual([])
  })

  it('flags cs.N that is not pk x bx but refuses to guess the fix', () => {
    // 15 x 3 = 45, not 36 — so the name is inconsistent, but which number is
    // wrong is not knowable from the name. Verified against real shipments:
    // F287672 reads "48/pk 150bx/cs cs.150" and physically arrived at 150 per
    // case, so recomputing cs.N from pk x bx would have written cs.7200.
    const audit = auditProductName('Brown Small Ribbon 1.5" - 15/pk 3bx/cs cs.36')
    expect(audit.issues).toContain('case_total_mismatch')
    expect(audit.suggestion).toBeNull()
  })

  it('still fixes a cosmetic problem on a name whose totals also disagree', () => {
    // The digit prefix is unambiguous; the pack numbers are left exactly as
    // found rather than recomputed.
    const audit = auditProductName('7491 - Widget - 48/pk 150bx/cs cs.150')
    expect(audit.suggestion).toBe('Widget - 48/pk 150bx/cs cs.150')
  })

  it('flags a name with no pack spec but cannot invent one', () => {
    const audit = auditProductName('Pizza Squishy')
    expect(audit.issues).toEqual(['missing_pack_spec'])
    expect(audit.suggestion).toBeNull()
  })

  it('flags the legacy digit prefix and rewrites it', () => {
    const audit = auditProductName('7491 - Magic Gold Heart Ribbon Gift Box - 1/pk 36bx/cs cs.36')
    expect(audit.issues).toContain('leading_sku_digits')
    expect(audit.suggestion).toBe('Magic Gold Heart Ribbon Gift Box - 1/pk 36bx/cs cs.36')
  })

  it('flags invoice material tails that leaked into a name', () => {
    expect(auditProductName('Handheld NeckFans - 100% PVC - 12/pk 5bx/cs cs.60').issues).toContain(
      'invoice_material_tail',
    )
  })

  it('leaves a compliant name without a suggestion', () => {
    expect(auditProductName('Pizza Squishy - 12/pk 8bx/cs cs.96').suggestion).toBeNull()
  })
})

describe('the two conventions', () => {
  // PIECE-SOLD: cs.N counts pieces, so cs = pk x bx.
  // PACK-SOLD:  cs.N counts packs,  so cs = bx.
  // Both are real. The Gift Bows are pack-sold ("20/pk 100bx/cs cs.100" = 20
  // per pack, 100 packs per case) and so are the floral papers — Dragon
  // confirmed each. Treating cs = pk x bx as the only rule flagged all 600
  // pack-sold names as broken and produced "corrections" that would have
  // rewritten correct ones.
  const bow = '10" Gold Gift Bow - 20/pk 100bx/cs cs.100'
  const bear = 'Foam Bear with Heart 7cm - 12/pk 10bx/cs cs.120'

  it('accepts a piece-sold spec', () => {
    expect(packSpecConvention(parseProductName(bear).spec!)).toBe('piece')
    expect(auditProductName(bear).issues).toEqual([])
  })

  it('accepts a pack-sold spec', () => {
    expect(packSpecConvention(parseProductName(bow).spec!)).toBe('pack')
    expect(auditProductName(bow).issues).toEqual([])
  })

  it('reports "either" when pk is 1, since the two agree', () => {
    const name = 'Magic Gold Heart Ribbon Gift Box - 1/pk 36bx/cs cs.36'
    expect(packSpecConvention(parseProductName(name).spec!)).toBe('either')
    expect(auditProductName(name).issues).toEqual([])
  })

  it('flags a spec that fits neither, and proposes nothing', () => {
    // Real defect: 15 x 3 = 45, and cs.36 isn't bx either.
    const name = 'Brown Small Ribbon 1.5" - 15/pk 3bx/cs cs.36'
    const audit = auditProductName(name)
    expect(packSpecConvention(parseProductName(name).spec!)).toBe('inconsistent')
    expect(audit.issues).toContain('case_total_mismatch')
    expect(audit.suggestion).toBeNull()
  })

  it('exposes the convention on the audit result', () => {
    expect(auditProductName(bow).convention).toBe('pack')
    expect(auditProductName('Pizza Squishy').convention).toBeNull()
  })

  it('does not need a SKU to judge a name', () => {
    // The shape itself identifies the convention, so no hand-maintained list
    // of pack-sold SKUs is required — an earlier version had one.
    expect(auditProductName(bow).issues).toEqual([])
  })
})
