import { describe, expect, it } from 'vitest'
import { catalogHref, filterChips } from '@/lib/catalog-url'
import { departmentBySlug, departmentSlug, DEPARTMENTS } from '@/lib/category-groups'

describe('catalogHref', () => {
  it('leaves defaults out and keeps everything else', () => {
    expect(catalogHref({})).toBe('/')
    expect(catalogHref({ sort: 'sku', per: 20, page: 1 })).toBe('/')
    expect(catalogHref({ q: 'bear', dept: 'toys', sort: 'price_asc', inStock: true, per: 50, page: 3 })).toBe('/?q=bear&dept=toys&sort=price_asc&instock=1&per=50&page=3')
  })
  it('lets a category win over a department', () => {
    expect(catalogHref({ category: 'papers', dept: 'florals-gifts' })).toBe('/?category=papers')
  })
})

describe('filterChips', () => {
  const s = { q: 'rose', dept: 'florals-gifts', inStock: true, soldBy: 'pack', caseSize: 'small', minPrice: '2', maxPrice: '10', sort: 'price_asc', per: 50, page: 4 }
  it('makes one chip per filter, each removing only itself and going back to page 1', () => {
    const chips = filterChips(s, { dept: 'Florals & Gifts' })
    expect(chips.map((c) => c.label)).toEqual(['All Florals & Gifts', '“rose”', 'In stock', 'Sold by the pack', 'Case: Up to 24 pcs', '$2 – $10'])
    expect(chips[0].href).toBe('/?q=rose&sort=price_asc&instock=1&soldby=pack&case=small&per=50&minPrice=2&maxPrice=10')
    expect(chips[2].href).not.toContain('instock')
    expect(chips[5].href).not.toMatch(/Price/)
    for (const c of chips) expect(c.href).not.toContain('page=')
  })
  it('words one-sided prices and shows a category instead of its department', () => {
    expect(filterChips({ minPrice: '5' }, {}).map((c) => c.label)).toEqual(['From $5'])
    expect(filterChips({ maxPrice: '5' }, {}).map((c) => c.label)).toEqual(['Up to $5'])
    expect(filterChips({ category: 'papers', dept: 'florals-gifts' }, { category: 'Papers', dept: 'Florals & Gifts' }).map((c) => c.label)).toEqual(['Papers'])
  })
  it('has no chips when nothing is filtered (sort and page size are not filters)', () => {
    expect(filterChips({ sort: 'name', per: 100 }, {})).toEqual([])
  })
})

describe('department slugs', () => {
  it('are URL-safe, unique and reversible', () => {
    expect(departmentSlug('Florals & Gifts')).toBe('florals-gifts')
    expect(departmentSlug('LED & Electronics')).toBe('led-electronics')
    const slugs = DEPARTMENTS.map((d) => departmentSlug(d.name))
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const d of DEPARTMENTS) expect(departmentBySlug(departmentSlug(d.name))?.name).toBe(d.name)
    expect(departmentBySlug('nope')).toBeNull()
    expect(departmentBySlug(undefined)).toBeNull()
  })
})
