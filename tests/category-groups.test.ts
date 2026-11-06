import { describe, expect, it } from 'vitest'
import { countCategories, departmentOf, DEPARTMENTS, groupCategories } from '@/lib/category-groups'

const cats = [
  { id: 'c1', name: 'Papers', slug: 'papers' },
  { id: 'c2', name: 'Ribbons', slug: 'ribbons' },
  { id: 'c3', name: 'Plush', slug: 'plush' },
  { id: 'c4', name: 'Chairs', slug: 'chairs' },
  { id: 'c5', name: 'Stationery & Office', slug: 'stationery' },
  { id: 'c6', name: 'Brand New Shelf', slug: 'new-shelf' },
]

describe('departments', () => {
  it('puts every category in exactly one department', () => {
    const all = DEPARTMENTS.flatMap((d) => d.categories)
    expect(new Set(all).size).toBe(all.length)
    expect(departmentOf('Papers')).toBe('Florals & Gifts')
    expect(departmentOf('Brand New Shelf')).toBe('More')
  })
})

describe('countCategories', () => {
  it('counts visible products per category and distinct products per department', () => {
    const counts = countCategories(
      new Set(['p1', 'p2', 'p3']),
      [
        { product_id: 'p1', category_id: 'c1' },
        { product_id: 'p1', category_id: 'c2' }, // same product in two Florals categories
        { product_id: 'p2', category_id: 'c2' },
        { product_id: 'p3', category_id: 'c3' },
        { product_id: 'hidden', category_id: 'c4' },
      ],
      cats,
    )
    expect(counts.byCategory).toEqual({ c1: 1, c2: 2, c3: 1 })
    expect(counts.byDepartment).toEqual({ 'Florals & Gifts': 2, Toys: 1 })
  })
})

describe('groupCategories', () => {
  const counts = { byCategory: { c1: 161, c2: 64, c3: 88, c5: 80, c6: 3 }, byDepartment: { 'Florals & Gifts': 200, Toys: 88, 'Stationery & Office': 80, More: 3 } }
  it('groups in menu order, biggest category first, hiding empty ones', () => {
    const g = groupCategories(cats, counts)
    expect(g.map((d) => [d.name, d.count, d.categories.map((c) => [c.name, c.count])])).toEqual([
      ['Florals & Gifts', 200, [['Papers', 161], ['Ribbons', 64]]],
      ['Toys', 88, [['Plush', 88]]],
      ['Stationery & Office', 80, [['Stationery & Office', 80]]],
      ['More', 3, [['Brand New Shelf', 3]]],
    ])
  })
  it('keeps an empty category when it is the one being viewed', () => {
    expect(groupCategories(cats, counts, 'chairs').some((d) => d.categories.some((c) => c.slug === 'chairs'))).toBe(true)
  })
  it('hides nothing and shows no numbers when counts failed to load', () => {
    const g = groupCategories(cats, null)
    expect(g.flatMap((d) => d.categories)).toHaveLength(6)
    expect(g.every((d) => d.count === null)).toBe(true)
  })
})
