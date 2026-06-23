import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const WINDOW_DAYS = 30
const FETCH_CAP = 20000 // bound the in-memory aggregation for busy catalogs

interface EventRow {
  type: 'view' | 'search'
  product_id: string | null
  term: string | null
}

function topCounts<K extends string>(keys: (K | null)[], limit: number): { key: K; count: number }[] {
  const tally = new Map<K, number>()
  for (const k of keys) {
    if (!k) continue
    tally.set(k, (tally.get(k) ?? 0) + 1)
  }
  return [...tally.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

export default async function AdminAnalyticsPage() {
  const db = getAdminClient()
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await db
    .from('analytics_events')
    .select('type, product_id, term')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(FETCH_CAP)

  const tableMissing = !!error
  const events = (data ?? []) as EventRow[]

  const views = events.filter((e) => e.type === 'view')
  const searches = events.filter((e) => e.type === 'search')

  const topProducts = topCounts(views.map((e) => e.product_id), 20)
  const topSearches = topCounts(searches.map((e) => e.term), 20)

  // Resolve product names for the top viewed products.
  let nameById = new Map<string, { name: string; sku: string | null }>()
  if (topProducts.length > 0) {
    const { data: prods } = await db
      .from('products')
      .select('id, name, sku')
      .in('id', topProducts.map((p) => p.key))
    nameById = new Map((prods ?? []).map((p) => [p.id, { name: p.name, sku: p.sku }]))
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-10">
        <div className="mb-6">
          <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            ← Back to Dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">Analytics</h1>
          <p className="text-sm text-gray-500">Last {WINDOW_DAYS} days</p>
        </div>

        {tableMissing ? (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            Analytics isn’t set up yet. Run <code className="font-mono">supabase/migrations/0003_analytics_events.sql</code> in
            the Supabase SQL editor, then product views and searches will be tracked here automatically.
          </div>
        ) : (
          <>
            <div className="mb-6 flex flex-wrap gap-4 text-sm">
              <span className="rounded-lg bg-white border border-gray-200 px-4 py-2 text-gray-700">
                <span className="font-semibold text-gray-900">{views.length.toLocaleString()}</span> product views
              </span>
              <span className="rounded-lg bg-white border border-gray-200 px-4 py-2 text-gray-700">
                <span className="font-semibold text-gray-900">{searches.length.toLocaleString()}</span> searches
              </span>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {/* Top viewed products */}
              <section className="rounded-xl bg-white border border-gray-200 overflow-hidden">
                <h2 className="px-4 py-3 text-sm font-semibold uppercase tracking-wide text-gray-500 border-b border-gray-100">
                  Most viewed products
                </h2>
                <ul className="divide-y divide-gray-100">
                  {topProducts.map((p) => {
                    const meta = nameById.get(p.key)
                    return (
                      <li key={p.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                        <Link href={`/product/${p.key}`} className="min-w-0 truncate text-sm text-gray-800 hover:text-red-600">
                          {meta?.name ?? p.key}
                        </Link>
                        <span className="shrink-0 text-sm font-semibold text-gray-900">{p.count}</span>
                      </li>
                    )
                  })}
                  {topProducts.length === 0 && (
                    <li className="px-4 py-8 text-center text-sm text-gray-400">No product views yet.</li>
                  )}
                </ul>
              </section>

              {/* Top searches */}
              <section className="rounded-xl bg-white border border-gray-200 overflow-hidden">
                <h2 className="px-4 py-3 text-sm font-semibold uppercase tracking-wide text-gray-500 border-b border-gray-100">
                  Top search terms
                </h2>
                <ul className="divide-y divide-gray-100">
                  {topSearches.map((s) => (
                    <li key={s.key} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <Link href={`/?q=${encodeURIComponent(s.key)}`} className="min-w-0 truncate text-sm text-gray-800 hover:text-red-600">
                        {s.key}
                      </Link>
                      <span className="shrink-0 text-sm font-semibold text-gray-900">{s.count}</span>
                    </li>
                  ))}
                  {topSearches.length === 0 && (
                    <li className="px-4 py-8 text-center text-sm text-gray-400">No searches yet.</li>
                  )}
                </ul>
              </section>
            </div>

            {events.length >= FETCH_CAP && (
              <p className="mt-4 text-xs text-gray-400">
                Showing the most recent {FETCH_CAP.toLocaleString()} events in the window.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
