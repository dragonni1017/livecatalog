import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'
import BulkStockTable from '@/components/admin/BulkStockTable'
import ProductCreateButton from '@/components/admin/ProductCreateButton'

export const dynamic = 'force-dynamic'

// Supabase/PostgREST enforces its own server-side max-rows cap (independent
// of whatever .limit()/.range() the client requests) -- confirmed live: this
// page showed "1,000 total" against 3,032 real products, and a just-saved
// category on an unordered full-table select could silently fall outside
// whatever arbitrary 1000-row subset came back. Paginate in real page-size
// chunks via .range() and concatenate, rather than trusting a single request
// to return everything.
const PAGE_SIZE = 1000

async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const all: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return all
}

interface VolumeTier { min_qty: number; price_cents: number }

interface AdminProduct {
  id: string
  sku: string | null
  name: string
  description: string | null
  image_url: string | null
  image_urls: string[]
  is_active: boolean
  manually_hidden: boolean
  stock_qty: number
  low_stock_threshold: number | null
  volume_tiers: VolumeTier[] | null
  price_cents: number
  unit_type: 'pc' | 'case' | 'box' | 'pack'
  category: { id: string; name: string } | null
  categoryIds: string[]
}

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; visibility?: string; active?: string }>
}) {
  const { q, category, visibility, active } = await searchParams
  const db = getAdminClient()

  const { data: categories } = await db
    .from('categories')
    .select('id, name, slug')
    .order('name')

  let memberIds: string[] | null = null
  if (category) {
    const cat = (categories ?? []).find((c) => c.slug === category)
    if (cat) {
      const rows = await fetchAllRows<{ product_id: string }>(
        (from, to) =>
          db.from('product_categories').select('product_id').eq('category_id', cat.id).range(from, to) as unknown as Promise<{
            data: { product_id: string }[] | null
            error: { message: string } | null
          }>,
      )
      memberIds = rows.map((r) => r.product_id)
    }
  }

  const baseProducts = await fetchAllRows<Omit<AdminProduct, 'categoryIds'>>((from, to) => {
    let pageQuery = db
      .from('products')
      .select('id, sku, name, description, image_url, image_urls, is_active, manually_hidden, stock_qty, low_stock_threshold, volume_tiers, price_cents, unit_type, category:categories!products_category_id_fkey(id, name)')
      .order('name')
      .range(from, to)

    if (q) pageQuery = pageQuery.or(`name.ilike.%${q}%,sku.ilike.%${q}%`)
    if (memberIds) pageQuery = pageQuery.in('id', memberIds.length > 0 ? memberIds : ['__none__'])
    if (visibility === 'hidden') pageQuery = pageQuery.eq('manually_hidden', true)
    if (visibility === 'visible') pageQuery = pageQuery.eq('manually_hidden', false)
    if (active === 'active') pageQuery = pageQuery.eq('is_active', true)
    if (active === 'inactive') pageQuery = pageQuery.eq('is_active', false)

    return pageQuery as unknown as Promise<{ data: Omit<AdminProduct, 'categoryIds'>[] | null; error: { message: string } | null }>
  })

  // Full category membership per product (product_categories can now hold
  // more than one row per product) -- fetched once for the whole visible
  // set rather than per-row, then grouped in memory.
  const allMemberRows = await fetchAllRows<{ product_id: string; category_id: string }>(
    (from, to) =>
      db.from('product_categories').select('product_id, category_id').range(from, to) as unknown as Promise<{
        data: { product_id: string; category_id: string }[] | null
        error: { message: string } | null
      }>,
  )
  const categoryIdsByProduct = new Map<string, string[]>()
  for (const row of allMemberRows) {
    const list = categoryIdsByProduct.get(row.product_id) ?? []
    list.push(row.category_id)
    categoryIdsByProduct.set(row.product_id, list)
  }
  const products: AdminProduct[] = baseProducts.map((p) => ({
    ...p,
    categoryIds: categoryIdsByProduct.get(p.id) ?? [],
  }))
  const total = products.length
  const hiddenCount = products.filter((p) => p.manually_hidden).length
  const noImageCount = products.filter((p) => !p.image_url || p.image_url.trim() === '').length
  const hasFilters = !!(q || category || visibility || active)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
              ← Back to Dashboard
            </Link>
            <h1 className="mt-2 text-2xl font-bold text-gray-900">Products &amp; Stock</h1>
          </div>
          <ProductCreateButton categories={(categories ?? []).map((c) => ({ id: c.id, name: c.name }))} />
        </div>

        {/* Counts */}
        <div className="mb-4 flex flex-wrap gap-4 text-sm">
          <span className="rounded-lg bg-white border border-gray-200 px-4 py-2 text-gray-700">
            <span className="font-semibold text-gray-900">{total.toLocaleString()}</span>{' '}
            {hasFilters ? 'matching' : 'total'}
          </span>
          <span className="rounded-lg bg-white border border-gray-200 px-4 py-2 text-gray-700">
            <span className="font-semibold text-gray-900">{hiddenCount.toLocaleString()}</span> hidden
          </span>
          <span className="rounded-lg bg-white border border-gray-200 px-4 py-2 text-gray-700">
            <span className="font-semibold text-gray-900">{noImageCount.toLocaleString()}</span> without image
          </span>
        </div>

        {/* Filters */}
        <form method="get" className="mb-6 flex flex-wrap items-center gap-3">
          <input
            type="search"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Search name or SKU…"
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900 w-56"
          />
          <select
            name="category"
            defaultValue={category ?? ''}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900"
          >
            <option value="">All categories</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            name="visibility"
            defaultValue={visibility ?? ''}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900"
          >
            <option value="">All visibility</option>
            <option value="visible">Visible</option>
            <option value="hidden">Hidden</option>
          </select>

          <select
            name="active"
            defaultValue={active ?? ''}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900"
          >
            <option value="">All status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>

          <button
            type="submit"
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
          >
            Apply
          </button>

          {hasFilters && (
            <a
              href="/admin/products"
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              Clear filters
            </a>
          )}
        </form>

        {/* Table with bulk selection */}
        <BulkStockTable products={products} categories={(categories ?? []).map((c) => ({ id: c.id, name: c.name }))} />
      </div>
    </div>
  )
}
