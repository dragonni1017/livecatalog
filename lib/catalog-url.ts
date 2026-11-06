// Catalog URLs and the "active filter" chips (app/(catalog)/page.tsx). Pure.
//
// One place builds every catalog link, so pagination, the price form and the
// chips all keep the same filters (including ?dept=, a whole department).

import { CASE_SIZES } from './catalog-filters.ts'

export interface CatalogState {
  q?: string
  category?: string
  dept?: string
  sort?: string
  inStock?: boolean
  soldBy?: string
  caseSize?: string
  per?: number
  minPrice?: string
  maxPrice?: string
  page?: number
}

const DEFAULT_SORT = 'sku'
const DEFAULT_PER = 20

/** "/?q=...&category=..." with defaults left out; "/" when nothing is set. */
export function catalogHref(s: CatalogState): string {
  const p = new URLSearchParams()
  if (s.q) p.set('q', s.q)
  if (s.category) p.set('category', s.category)
  else if (s.dept) p.set('dept', s.dept)
  if (s.sort && s.sort !== DEFAULT_SORT) p.set('sort', s.sort)
  if (s.inStock) p.set('instock', '1')
  if (s.soldBy) p.set('soldby', s.soldBy)
  if (s.caseSize) p.set('case', s.caseSize)
  if (s.per && s.per !== DEFAULT_PER) p.set('per', String(s.per))
  if (s.minPrice) p.set('minPrice', s.minPrice)
  if (s.maxPrice) p.set('maxPrice', s.maxPrice)
  if (s.page && s.page > 1) p.set('page', String(s.page))
  const qs = p.toString()
  return qs ? `/?${qs}` : '/'
}

export interface FilterChip {
  label: string
  /** The same view without this one filter, back on page 1. */
  href: string
}

/**
 * One chip per filter in effect, each linking to the view without it. Sort,
 * page size and page aren't filters, so they're kept and never chipped.
 */
export function filterChips(s: CatalogState, names: { category?: string; dept?: string }): FilterChip[] {
  const base: CatalogState = { ...s, page: undefined }
  const without = (patch: Partial<CatalogState>) => catalogHref({ ...base, ...patch })
  const chips: FilterChip[] = []
  if (s.category && names.category) chips.push({ label: names.category, href: without({ category: undefined }) })
  else if (s.dept && names.dept) chips.push({ label: `All ${names.dept}`, href: without({ dept: undefined }) })
  if (s.q) chips.push({ label: `“${s.q}”`, href: without({ q: undefined }) })
  if (s.inStock) chips.push({ label: 'In stock', href: without({ inStock: false }) })
  if (s.soldBy) chips.push({ label: s.soldBy === 'pack' ? 'Sold by the pack' : 'Sold by the piece', href: without({ soldBy: undefined }) })
  const cs = CASE_SIZES.find((c) => c.value === s.caseSize)
  if (cs) chips.push({ label: `Case: ${cs.label}`, href: without({ caseSize: undefined }) })
  if (s.minPrice || s.maxPrice) {
    const label = s.minPrice && s.maxPrice ? `$${s.minPrice} – $${s.maxPrice}` : s.minPrice ? `From $${s.minPrice}` : `Up to $${s.maxPrice}`
    chips.push({ label, href: without({ minPrice: undefined, maxPrice: undefined }) })
  }
  return chips
}
