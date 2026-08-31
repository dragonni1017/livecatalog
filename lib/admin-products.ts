import type { SupabaseClient } from '@supabase/supabase-js'

// Supabase/PostgREST enforces its own server-side max-rows cap (independent
// of whatever .limit()/.range() the client requests) -- confirmed live
// 2026-08-31: an unbounded product_categories select silently truncated at
// 1000 of 3000+ real rows. Anywhere that genuinely needs "every matching
// row" (not just one display page) must paginate in real chunks via
// .range() and concatenate, rather than trusting a single request.
const FETCH_ALL_PAGE_SIZE = 1000

export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const all: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await fetchPage(from, from + FETCH_ALL_PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < FETCH_ALL_PAGE_SIZE) break
    from += FETCH_ALL_PAGE_SIZE
  }
  return all
}

export interface AdminProductFilterParams {
  q?: string
  category?: string
  visibility?: string
  active?: string
}

// Resolves a category slug (from the URL/request) to every product_id
// currently in that category, or null if no category filter is active (or
// the slug doesn't match any real category). Paginated since a category
// could in principle hold more than 1000 products.
export async function resolveCategoryMemberIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any, any, any>,
  categories: { id: string; slug: string }[],
  categorySlug: string | undefined,
): Promise<string[] | null> {
  if (!categorySlug) return null
  const cat = categories.find((c) => c.slug === categorySlug)
  if (!cat) return null
  const rows = await fetchAllRows<{ product_id: string }>(
    (from, to) =>
      db.from('product_categories').select('product_id').eq('category_id', cat.id).range(from, to) as unknown as Promise<{
        data: { product_id: string }[] | null
        error: { message: string } | null
      }>,
  )
  return rows.map((r) => r.product_id)
}

// Applies the shared q/category/visibility/active filters to a products
// query builder -- used both by the paginated display query
// (app/admin/products/page.tsx) and by the "select all matching filter" bulk
// stock action (app/admin/api/stock/bulk/route.ts), so the two can never
// silently drift apart on what "matching the current filter" means.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyAdminProductFilters<Q extends { or: any; in: any; eq: any }>(
  query: Q,
  filters: AdminProductFilterParams,
  memberIds: string[] | null,
): Q {
  let q = query
  if (filters.q) q = q.or(`name.ilike.%${filters.q}%,sku.ilike.%${filters.q}%`)
  if (memberIds) q = q.in('id', memberIds.length > 0 ? memberIds : ['__none__'])
  if (filters.visibility === 'hidden') q = q.eq('manually_hidden', true)
  if (filters.visibility === 'visible') q = q.eq('manually_hidden', false)
  if (filters.active === 'active') q = q.eq('is_active', true)
  if (filters.active === 'inactive') q = q.eq('is_active', false)
  return q
}
