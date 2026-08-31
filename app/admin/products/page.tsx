import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'
import BulkStockTable from '@/components/admin/BulkStockTable'
import ProductCreateButton from '@/components/admin/ProductCreateButton'
import { applyAdminProductFilters, resolveCategoryMemberIds, type AdminProductFilterParams } from '@/lib/admin-products'

export const dynamic = 'force-dynamic'

// Real page-based pagination -- until 2026-08-31 this page fetched and
// rendered all ~3,032 products in one request/DOM tree (working around
// PostgREST's row cap by paginating internally, but still loading
// everything). Now only one page's worth is ever fetched or rendered;
// "select all matching filter" (BulkStockTable/BulkActionBar) re-resolves
// the full matching set server-side instead of requiring every id to be
// loaded into the browser -- see app/admin/api/stock/bulk/route.ts.
const DISPLAY_PAGE_SIZE = 100

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

const PRODUCT_COLUMNS =
  'id, sku, name, description, image_url, image_urls, is_active, manually_hidden, stock_qty, low_stock_threshold, volume_tiers, price_cents, unit_type, category:categories!products_category_id_fkey(id, name)'

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; visibility?: string; active?: string; page?: string }>
}) {
  const { q, category, visibility, active, page: pageParam } = await searchParams
  const db = getAdminClient()
  const page = Math.max(1, parseInt(pageParam ?? '1', 10) || 1)

  const { data: categories } = await db
    .from('categories')
    .select('id, name, slug')
    .order('name')
  const categoryList = categories ?? []

  const filters: AdminProductFilterParams = { q, category, visibility, active }
  const memberIds = await resolveCategoryMemberIds(db, categoryList, category)

  const from = (page - 1) * DISPLAY_PAGE_SIZE
  const to = from + DISPLAY_PAGE_SIZE - 1

  const { data, count: total } = await applyAdminProductFilters(
    db.from('products').select(PRODUCT_COLUMNS, { count: 'exact' }).order('name').range(from, to),
    filters,
    memberIds,
  )
  const baseProducts = (data ?? []) as unknown as Omit<AdminProduct, 'categoryIds'>[]

  const { count: hiddenCount } = await applyAdminProductFilters(
    db.from('products').select('id', { count: 'exact', head: true }).eq('manually_hidden', true),
    filters,
    memberIds,
  )
  const { count: noImageCount } = await applyAdminProductFilters(
    db.from('products').select('id', { count: 'exact', head: true }).or('image_url.is.null,image_url.eq.'),
    filters,
    memberIds,
  )

  // Category membership for just this page's products (not the whole
  // catalog) -- naturally bounded to DISPLAY_PAGE_SIZE rows worth, so no
  // need for the full-table pagination workaround here anymore.
  const pageProductIds = baseProducts.map((p) => p.id)
  const { data: memberRows } =
    pageProductIds.length > 0
      ? await db.from('product_categories').select('product_id, category_id').in('product_id', pageProductIds)
      : { data: [] }
  const categoryIdsByProduct = new Map<string, string[]>()
  for (const row of memberRows ?? []) {
    const list = categoryIdsByProduct.get(row.product_id) ?? []
    list.push(row.category_id)
    categoryIdsByProduct.set(row.product_id, list)
  }
  const products: AdminProduct[] = baseProducts.map((p) => ({
    ...p,
    categoryIds: categoryIdsByProduct.get(p.id) ?? [],
  }))

  const totalCount = total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalCount / DISPLAY_PAGE_SIZE))
  const hasFilters = !!(q || category || visibility || active)

  const paramsForPage = (targetPage: number) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (category) params.set('category', category)
    if (visibility) params.set('visibility', visibility)
    if (active) params.set('active', active)
    if (targetPage > 1) params.set('page', String(targetPage))
    const qs = params.toString()
    return qs ? `/admin/products?${qs}` : '/admin/products'
  }

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
          <ProductCreateButton categories={categoryList.map((c) => ({ id: c.id, name: c.name }))} />
        </div>

        {/* Counts */}
        <div className="mb-4 flex flex-wrap gap-4 text-sm">
          <span className="rounded-lg bg-white border border-gray-200 px-4 py-2 text-gray-700">
            <span className="font-semibold text-gray-900">{totalCount.toLocaleString()}</span>{' '}
            {hasFilters ? 'matching' : 'total'}
          </span>
          <span className="rounded-lg bg-white border border-gray-200 px-4 py-2 text-gray-700">
            <span className="font-semibold text-gray-900">{(hiddenCount ?? 0).toLocaleString()}</span> hidden
          </span>
          <span className="rounded-lg bg-white border border-gray-200 px-4 py-2 text-gray-700">
            <span className="font-semibold text-gray-900">{(noImageCount ?? 0).toLocaleString()}</span> without image
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
            {categoryList.map((c) => (
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
        <BulkStockTable
          products={products}
          categories={categoryList.map((c) => ({ id: c.id, name: c.name }))}
          totalCount={totalCount}
          filters={filters}
        />

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
            <span>
              Showing {(from + 1).toLocaleString()}–{Math.min(from + DISPLAY_PAGE_SIZE, totalCount).toLocaleString()} of{' '}
              {totalCount.toLocaleString()}
            </span>
            <div className="flex items-center gap-2">
              {page > 1 ? (
                <a href={paramsForPage(page - 1)} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 hover:bg-gray-50 transition-colors">
                  ← Prev
                </a>
              ) : (
                <span className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-1.5 text-gray-300">← Prev</span>
              )}
              <span className="px-2">
                Page {page} of {totalPages}
              </span>
              {page < totalPages ? (
                <a href={paramsForPage(page + 1)} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 hover:bg-gray-50 transition-colors">
                  Next →
                </a>
              ) : (
                <span className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-1.5 text-gray-300">Next →</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
