import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'
import BulkStockTable from '@/components/admin/BulkStockTable'

export const dynamic = 'force-dynamic'

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

  let query = db
    .from('products')
    .select('id, sku, name, description, image_url, image_urls, is_active, manually_hidden, stock_qty, low_stock_threshold, volume_tiers, price_cents, unit_type, category:categories(id, name)')
    .order('name')
    .limit(10000)

  if (q) query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%`)
  if (category) {
    const cat = (categories ?? []).find((c) => c.slug === category)
    if (cat) query = query.eq('category_id', cat.id)
  }
  if (visibility === 'hidden') query = query.eq('manually_hidden', true)
  if (visibility === 'visible') query = query.eq('manually_hidden', false)
  if (active === 'active') query = query.eq('is_active', true)
  if (active === 'inactive') query = query.eq('is_active', false)

  const { data } = await query
  const products = (data ?? []) as unknown as AdminProduct[]
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
        <BulkStockTable products={products} />
      </div>
    </div>
  )
}
