import { packSpecConvention, parseProductName } from '@/lib/product-naming'

// The catalog's "Case size" and "Sold by" filters. They filter on
// products.case_pieces / products.sold_by, generated columns in migration
// 0054 computed from the name in SQL. The two functions below are the same
// rules in TS: tests pin them, and the live columns are checked against them.

export type SoldBy = 'piece' | 'pack'

/** Pieces per pack × packs per case: always pieces. null without a pack spec. */
export function casePiecesFor(name: string): number | null {
  const { spec } = parseProductName(name)
  return spec ? spec.piecesPerPack * spec.boxesPerCase : null
}

/** 'piece' | 'pack', or null with no spec or one that fits neither convention. */
export function soldByFor(name: string): SoldBy | null {
  const { spec } = parseProductName(name)
  if (!spec) return null
  const c = packSpecConvention(spec)
  // 'either' = 1 piece per pack, which is sold singly.
  return c === 'piece' || c === 'either' ? 'piece' : c === 'pack' ? 'pack' : null
}

// Groups sized from the live catalog (2026-10-02: case pieces run
// p10 18, p25 36, p50 60, p75 180, p90 240).
export const CASE_SIZES = [
  { value: 'small', label: 'Up to 24 pcs', min: null, max: 24 },
  { value: 'medium', label: '25–100 pcs', min: 25, max: 100 },
  { value: 'large', label: '101–250 pcs', min: 101, max: 250 },
  { value: 'bulk', label: 'Over 250 pcs', min: 251, max: null },
] as const

export type CaseSize = (typeof CASE_SIZES)[number]['value']

export function parseCaseSize(raw: string | undefined): (typeof CASE_SIZES)[number] | null {
  return CASE_SIZES.find((c) => c.value === raw) ?? null
}

export function parseSoldBy(raw: string | undefined): SoldBy | null {
  return raw === 'piece' || raw === 'pack' ? raw : null
}
