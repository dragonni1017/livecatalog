// Storefront category menu: the flat list of 43 categories grouped into
// departments (components/catalog/CategoryNav.tsx). Pure.
//
// A category with no products showing is hidden (unless it's the one being
// viewed), and a department with one category shows as a plain link. A
// category not listed here lands in "More", so a new category still appears.

export interface Department {
  name: string
  categories: string[]
}

export const DEPARTMENTS: Department[] = [
  {
    name: 'Florals & Gifts',
    categories: ['Papers', 'Ribbons', 'Floral Supplies', 'Floral Boxes', 'Floral Basket', 'Gift Bags', 'Flowers', 'Flower Spray', 'Leis', 'Bows', 'Mesh Paper', 'Crowns', 'Candles', 'Gifts', 'Flower Bears', 'Forever Roses'],
  },
  { name: 'Toys', categories: ['Toys & Novelties', 'Plush', '3D Printed', 'Crochet', 'Skateboard'] },
  { name: 'Accessories & Beauty', categories: ['Keychains', 'Bags/Purses', 'Accessories & Apparel', 'Beauty & Personal Care', 'Umbrella', 'Blankets'] },
  { name: 'Drinkware', categories: ['Drinkware & Cups', 'Plate Set'] },
  { name: 'Stationery & Office', categories: ['Stationery & Office'] },
  { name: 'LED & Electronics', categories: ['LED', 'LED/Electronics', 'Lamps', 'Dome', 'Fan', 'Speakers', 'Humidifier'] },
  { name: 'Home & Decor', categories: ['Deco', 'Picture Frames', 'Signs/Animals', 'Chairs', 'Candy'] },
  { name: 'Seasonal', categories: ['Seasonal & Holiday'] },
]

export interface NavCategory {
  id: string
  name: string
  slug: string
}

export interface CategoryCounts {
  /** category id -> products showing in it */
  byCategory: Record<string, number>
  /** department name -> distinct products showing across its categories */
  byDepartment: Record<string, number>
}

export interface NavDepartment<C extends NavCategory = NavCategory> {
  name: string
  count: number | null
  categories: (C & { count: number | null })[]
}

/** Department name for a category name ("More" when unlisted). */
export function departmentOf(categoryName: string): string {
  return DEPARTMENTS.find((d) => d.categories.includes(categoryName))?.name ?? 'More'
}

/**
 * Departments in menu order with their visible categories, biggest first.
 * Without counts (lookup failed) nothing is hidden and no numbers show.
 */
export function groupCategories<C extends NavCategory>(categories: C[], counts: CategoryCounts | null, activeSlug?: string): NavDepartment<C>[] {
  const order = [...DEPARTMENTS.map((d) => d.name), 'More']
  const by = new Map<string, (C & { count: number | null })[]>()
  for (const c of categories) {
    const count = counts ? (counts.byCategory[c.id] ?? 0) : null
    if (counts && count === 0 && c.slug !== activeSlug) continue
    const d = departmentOf(c.name)
    by.set(d, [...(by.get(d) ?? []), { ...c, count }])
  }
  return order
    .filter((d) => by.has(d))
    .map((d) => ({
      name: d,
      count: counts ? (counts.byDepartment[d] ?? null) : null,
      categories: by.get(d)!.sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.name.localeCompare(b.name)),
    }))
}

/** Counts from visible product ids and product_categories rows (the same membership the category filter uses). */
export function countCategories(visibleIds: Set<string>, memberships: { product_id: string; category_id: string }[], categories: NavCategory[]): CategoryCounts {
  const nameById = new Map(categories.map((c) => [c.id, c.name]))
  const perCat = new Map<string, Set<string>>()
  const perDept = new Map<string, Set<string>>()
  for (const m of memberships) {
    if (!visibleIds.has(m.product_id)) continue
    const name = nameById.get(m.category_id)
    if (!name) continue
    ;(perCat.get(m.category_id) ?? perCat.set(m.category_id, new Set()).get(m.category_id)!).add(m.product_id)
    const d = departmentOf(name)
    ;(perDept.get(d) ?? perDept.set(d, new Set()).get(d)!).add(m.product_id)
  }
  return {
    byCategory: Object.fromEntries([...perCat].map(([k, v]) => [k, v.size])),
    byDepartment: Object.fromEntries([...perDept].map(([k, v]) => [k, v.size])),
  }
}
