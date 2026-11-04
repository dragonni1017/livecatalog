import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'
import { hiddenSearchDemand } from '@/lib/hidden-search-demand'
import { loadNoResultEvents } from '@/lib/hidden-search-demand-load'
import { rankShotList, shotReasons, type ShotListInput } from '@/lib/photo-shot-list'
import PrintButton from '@/components/admin/PrintButton'

export const dynamic = 'force-dynamic'

// Printable list of products to photograph, most worth shooting first
// (lib/photo-shot-list.ts). A product drops off by itself once its photo is
// uploaded on Cleanup -> Needs photo.

const SIZES = [25, 50, 100] as const
const COLUMNS = 'id, sku, name, barcode, image_url, needs_photo, is_active, manually_hidden, stock_qty, price_cents, arrived_at, category_id'

type Row = ShotListInput & { barcode: string | null }

// Ordered by id: range() paging over a non-unique sort drops rows.
async function fetchActive(db: ReturnType<typeof getAdminClient>): Promise<Row[]> {
  const all: Row[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('products')
      .select(COLUMNS)
      .eq('is_active', true)
      .order('id', { ascending: true })
      .range(from, from + 999)
    if (error) throw error
    all.push(...((data ?? []) as unknown as Row[]))
    if (!data || data.length < 1000) break
  }
  return all
}

// product_id -> a category from product_categories, for products whose
// category_id is null (they still show in that category). Stable paging on
// both key columns.
async function fetchLinkedCategory(db: ReturnType<typeof getAdminClient>): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('product_categories')
      .select('product_id, category_id')
      .order('product_id', { ascending: true })
      .order('category_id', { ascending: true })
      .range(from, from + 999)
    if (error) throw error
    for (const r of data ?? []) if (!out.has(String(r.product_id))) out.set(String(r.product_id), String(r.category_id))
    if (!data || data.length < 1000) break
  }
  return out
}

export default async function PhotoShotListPage({
  searchParams,
}: {
  searchParams: Promise<{ n?: string; category?: string }>
}) {
  const { n: nParam, category } = await searchParams
  const size = nParam === 'all' ? null : (SIZES as readonly number[]).includes(Number(nParam)) ? Number(nParam) : 50

  const db = getAdminClient()
  const [products, linkedCat, events, { data: catData, error: catError }] = await Promise.all([
    fetchActive(db),
    fetchLinkedCategory(db),
    loadNoResultEvents(db),
    db.from('categories').select('id, name').order('name'),
  ])
  if (catError) throw catError
  const catName = new Map((catData ?? []).map((c) => [String(c.id), String(c.name)]))

  const searchesById = new Map(
    hiddenSearchDemand(events ?? [], products.map((p) => ({ ...p, sku: p.sku ?? '', name: p.name ?? '' }))).map(
      (r) => [r.product.id, r.times],
    ),
  )
  const ranked = rankShotList(products, searchesById)
  const catOf = (p: Row) => p.category_id ?? linkedCat.get(p.id) ?? null
  const inCategory = category ? ranked.filter((r) => catOf(r.product) === category) : ranked
  const shown = size ? inCategory.slice(0, size) : inCategory

  // Categories that have something to shoot, biggest first, for the filter.
  const catCounts = new Map<string, number>()
  for (const r of ranked) {
    const c = catOf(r.product)
    if (c) catCounts.set(c, (catCounts.get(c) ?? 0) + 1)
  }
  const catOptions = [...catCounts].sort((a, b) => b[1] - a[1])

  const link = (o: { n?: string; category?: string | null }) => {
    const params = new URLSearchParams()
    const nn = o.n ?? (size ? String(size) : 'all')
    if (nn !== '50') params.set('n', nn)
    const cc = o.category === undefined ? category : o.category
    if (cc) params.set('category', cc)
    const qs = params.toString()
    return qs ? `/admin/photo-shot-list?${qs}` : '/admin/photo-shot-list'
  }

  const priced = ranked.filter((r) => (r.product.price_cents ?? 0) > 0).length
  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  return (
    <div className="min-h-screen bg-gray-50 print:bg-white">
      <div className="max-w-5xl mx-auto px-4 py-10 print:px-0 print:py-0">
        <div className="mb-6 print:hidden">
          <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            ← Back to Dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">Photo shot list</h1>
          <p className="mt-1 text-sm text-gray-500">
            {ranked.length} in-stock product{ranked.length === 1 ? '' : 's'} still need a photo ({priced} priced, so
            ready to sell once photographed). Most worth shooting first: holiday coming up, then SKUs customers
            searched for, then newest arrivals. Name each photo by its SKU (SKU, SKU-2, …) and drop them on{' '}
            <Link href="/admin/cleanup" className="text-red-600 hover:underline">Cleanup → Needs photo</Link>; each
            product leaves this list once its photo is in.
          </p>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm print:hidden">
          <span className="text-gray-500">Show</span>
          {[...SIZES.map(String), 'all'].map((v) => (
            <Link
              key={v}
              href={link({ n: v })}
              className={`rounded-md border px-3 py-1.5 ${
                (size ? String(size) : 'all') === v
                  ? 'border-red-600 bg-red-600 text-white'
                  : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              {v === 'all' ? 'All' : `Top ${v}`}
            </Link>
          ))}
          <form action="/admin/photo-shot-list" className="flex items-center gap-2">
            {size !== 50 && <input type="hidden" name="n" value={size ? String(size) : 'all'} />}
            <select
              name="category"
              defaultValue={category ?? ''}
              className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
            >
              <option value="">All categories</option>
              {catOptions.map(([id, count]) => (
                <option key={id} value={id}>
                  {catName.get(id) ?? 'Unknown'} ({count})
                </option>
              ))}
            </select>
            <button type="submit" className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-gray-700 hover:bg-gray-50">
              Filter
            </button>
          </form>
          <div className="ml-auto">
            <PrintButton />
          </div>
        </div>

        <div className="mb-3 hidden print:block">
          <h1 className="text-lg font-bold">
            Photo shot list{category ? `: ${catName.get(category) ?? ''}` : ''}
          </h1>
          <p className="text-xs text-gray-600">
            {today} · {shown.length} of {inCategory.length} · name each photo by its SKU
          </p>
        </div>

        {shown.length === 0 ? (
          <div className="rounded-xl bg-white border border-gray-200 px-6 py-12 text-center text-sm text-gray-400">
            Nothing to shoot: every in-stock product{category ? ' in this category' : ''} has a photo.
          </div>
        ) : (
          <div className="rounded-xl bg-white border border-gray-200 overflow-x-auto print:rounded-none print:border-0">
            <table className="w-full text-sm print:text-xs">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 print:bg-white">
                  <th className="px-3 py-2 w-8">#</th>
                  <th className="px-3 py-2 w-8 print:table-cell hidden">✓</th>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Product</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2 text-right">Stock</th>
                  <th className="px-3 py-2">Why</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {shown.map((r, i) => (
                  <tr key={r.product.id} className="break-inside-avoid">
                    <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                    <td className="px-3 py-2 hidden print:table-cell">
                      <span className="inline-block h-4 w-4 border border-gray-500" />
                    </td>
                    <td className="px-3 py-2 font-mono font-semibold text-gray-900 whitespace-nowrap">{r.product.sku}</td>
                    <td className="px-3 py-2 text-gray-800">{r.product.name}</td>
                    <td className="px-3 py-2 text-gray-500">{catName.get(catOf(r.product) ?? '') ?? ''}</td>
                    <td className="px-3 py-2 text-right text-gray-700">{r.product.stock_qty ?? 0}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {shotReasons(r).map((reason) => (
                          <span
                            key={reason}
                            className={`rounded px-1.5 py-0.5 text-xs ${
                              reason.startsWith('$0')
                                ? 'bg-gray-100 text-gray-500'
                                : 'bg-amber-100 text-amber-800 print:bg-white print:border print:border-gray-400'
                            }`}
                          >
                            {reason}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {size && inCategory.length > shown.length && (
          <p className="mt-3 text-sm text-gray-500 print:hidden">
            Showing the top {shown.length} of {inCategory.length}.{' '}
            <Link href={link({ n: 'all' })} className="text-red-600 hover:underline">Show all</Link>
          </p>
        )}
      </div>
    </div>
  )
}
