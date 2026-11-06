import { supabase } from '@/lib/supabase'
import { countCategories, type CategoryCounts, type NavCategory } from '@/lib/category-groups'

// Products showing per category and per department, for the grouped
// category menu. Counted through product_categories, the same membership
// the ?category= filter uses, so a number always matches what a click shows.
// Kept per server instance for 10 minutes: the menu is on every catalog page.
// Null on any error, and the menu then shows without numbers.
const TTL_MS = 10 * 60 * 1000
let cached: { at: number; key: string; counts: CategoryCounts } | null = null

export async function loadCategoryCounts(categories: NavCategory[]): Promise<CategoryCounts | null> {
  const key = categories.map((c) => c.id).join(',')
  if (cached && cached.key === key && Date.now() - cached.at < TTL_MS) return cached.counts
  try {
    const visible = new Set<string>()
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('products')
        .select('id')
        .eq('is_active', true)
        .eq('manually_hidden', false)
        .order('id')
        .range(from, from + 999)
      if (error) throw error
      for (const p of data ?? []) visible.add(String(p.id))
      if (!data || data.length < 1000) break
    }
    const memberships: { product_id: string; category_id: string }[] = []
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('product_categories')
        .select('product_id, category_id')
        .order('product_id')
        .order('category_id')
        .range(from, from + 999)
      if (error) throw error
      memberships.push(...((data ?? []) as { product_id: string; category_id: string }[]))
      if (!data || data.length < 1000) break
    }
    const counts = countCategories(visible, memberships, categories)
    cached = { at: Date.now(), key, counts }
    return counts
  } catch (err) {
    console.error('[category-counts] load failed:', err instanceof Error ? err.message : err)
    return null
  }
}
