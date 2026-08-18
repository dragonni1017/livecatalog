import { describe, it, expect } from 'vitest'
import { extractPackSpec, extractUnitsPerCase, stripCsSuffix } from '@/lib/pack'

describe('extractPackSpec', () => {
  it('returns null for null input', () => {
    expect(extractPackSpec(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(extractPackSpec(undefined)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(extractPackSpec('')).toBeNull()
  })

  it('returns null for a plain product name with no spec', () => {
    expect(extractPackSpec('Red Plastic Cups')).toBeNull()
  })

  it('extracts spec with case count', () => {
    expect(extractPackSpec('Large 3D Printed Lobster - 12/pk 12bx/cs cs.144')).toBe('12/pk 12bx/cs cs.144')
  })

  it('extracts spec without case count', () => {
    expect(extractPackSpec('1.5M 3D Chinese Dragon - 1/pk 1bx/cs')).toBe('1/pk 1bx/cs')
  })

  it('extracts spec with larger quantities', () => {
    expect(extractPackSpec('Foam Noodle Set - 24/pk 24bx/cs cs.576')).toBe('24/pk 24bx/cs cs.576')
  })

  it('is case-insensitive', () => {
    const result = extractPackSpec('Party Set - 6/PK 6BX/CS CS.36')
    expect(result).not.toBeNull()
  })

  it('collapses extra whitespace in the extracted spec', () => {
    const result = extractPackSpec('Item - 12/pk  12bx/cs  cs.144')
    expect(result).toBe('12/pk 12bx/cs cs.144')
  })

  it('returns only the spec portion, not the full name', () => {
    const result = extractPackSpec('Decorative Bowl Set - 6/pk 6bx/cs cs.36')
    expect(result).not.toContain('Decorative Bowl Set')
    expect(result).toBe('6/pk 6bx/cs cs.36')
  })

  it('returns null when only pk appears but not bx/cs', () => {
    expect(extractPackSpec('Widget 12/pk')).toBeNull()
  })
})

describe('extractUnitsPerCase', () => {
  it('returns 0 when there is no pack spec', () => {
    expect(extractUnitsPerCase('Red Plastic Cups')).toBe(0)
  })

  it('reads the explicit cs.N total when present', () => {
    expect(extractUnitsPerCase('Large 3D Printed Lobster - 12/pk 12bx/cs cs.144')).toBe(144)
  })

  it('derives per-pack x packs-per-case when cs.N is absent', () => {
    expect(extractUnitsPerCase('Large 3D Printed Lobster - 12/pk 12bx/cs')).toBe(144)
  })

  it('matches the explicit total for a single-unit pack', () => {
    expect(extractUnitsPerCase('1.5M 3D Chinese Dragon - 1/pk 1bx/cs')).toBe(1)
  })
})

describe('stripCsSuffix', () => {
  it('returns empty string for null/undefined', () => {
    expect(stripCsSuffix(null)).toBe('')
    expect(stripCsSuffix(undefined)).toBe('')
  })

  it('drops the trailing cs.N marker from a product name', () => {
    expect(stripCsSuffix('Large 3D Printed Lobster - 12/pk 12bx/cs cs.144')).toBe(
      'Large 3D Printed Lobster - 12/pk 12bx/cs',
    )
  })

  it('leaves names with no cs.N marker unchanged', () => {
    expect(stripCsSuffix('1.5M 3D Chinese Dragon - 1/pk 1bx/cs')).toBe('1.5M 3D Chinese Dragon - 1/pk 1bx/cs')
  })

  it('drops a dangling separator left behind after stripping mid-sentence', () => {
    expect(stripCsSuffix('12 pcs/inner · 10 inners/case · cs.120')).toBe(
      '12 pcs/inner · 10 inners/case',
    )
  })

  it('drops a cs.N marker with a unit annotation glued directly onto the digits', () => {
    expect(stripCsSuffix('Christmas Crochet Pins - 12/pk 50bx/cs cs.50pk')).toBe(
      'Christmas Crochet Pins - 12/pk 50bx/cs',
    )
  })
})
