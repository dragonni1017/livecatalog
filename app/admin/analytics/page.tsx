import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const FETCH_CAP = 20000

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

interface EventRow {
  type: 'view' | 'search'
  product_id: string | null
  term: string | null
}

interface OrderRow {
  id: string
  created_at: string
  status: string
  subtotal_cents: number
}

interface OrderItemRow {
  product_id: string
  name: string
  sku: string
  qty: number
  line_total_cents: number
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

function formatDollars(cents: number) {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function buildDailyBuckets(windowDays: number): { labels: string[]; counts: Record<string, number> } {
  const labels: string[] = []
  const counts: Record<string, number> = {}
  const now = Date.now()
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000)
    const key = d.toISOString().slice(0, 10)
    labels.push(key)
    counts[key] = 0
  }
  return { labels, counts }
}

function buildWeeklyBuckets(earliestDate: string): { labels: string[]; counts: Record<string, number> } {
  const start = new Date(earliestDate)
  // Snap to the Monday of the week containing earliestDate
  const dow = start.getUTCDay() // 0=Sun
  const diff = dow === 0 ? -6 : 1 - dow
  const weekStart = new Date(start)
  weekStart.setUTCDate(weekStart.getUTCDate() + diff)
  weekStart.setUTCHours(0, 0, 0, 0)

  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)

  const labels: string[] = []
  const counts: Record<string, number> = {}

  const cur = new Date(weekStart)
  while (cur <= today) {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const label = `${monthNames[cur.getUTCMonth()]} ${cur.getUTCDate()}`
    labels.push(label)
    counts[label] = 0
    cur.setUTCDate(cur.getUTCDate() + 7)
  }

  return { labels, counts }
}

/** Given an ISO date string, return the label for its week bucket (e.g. 'Jun 1') */
function weekLabelFor(dateStr: string): string {
  const d = new Date(dateStr)
  d.setUTCHours(0, 0, 0, 0)
  const dow = d.getUTCDay()
  const diff = dow === 0 ? -6 : 1 - dow
  d.setUTCDate(d.getUTCDate() + diff)
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${monthNames[d.getUTCMonth()]} ${d.getUTCDate()}`
}

interface BarChartProps {
  labels: string[]
  counts: Record<string, number>
}

function BarChart({ labels, counts }: BarChartProps) {
  const maxCount = Math.max(...labels.map((d) => counts[d]), 1)
  const BAR_W = 13
  const BAR_GAP = 6
  const CHART_H = 120
  const LABEL_H = 22
  const totalW = labels.length * (BAR_W + BAR_GAP) - BAR_GAP

  return (
    <svg
      viewBox={`0 0 ${totalW} ${CHART_H + LABEL_H}`}
      className="w-full"
      aria-label="Orders over time bar chart"
    >
      {labels.map((label, i) => {
        const count = counts[label]
        const barH = count === 0 ? 2 : Math.max(4, Math.round((count / maxCount) * CHART_H))
        const x = i * (BAR_W + BAR_GAP)
        const y = CHART_H - barH
        const showLabel = i === 0 || i === labels.length - 1 || i % 5 === 0
        // For daily buckets the label is YYYY-MM-DD; show as MM/DD
        const displayLabel = /^\d{4}-\d{2}-\d{2}$/.test(label) ? label.slice(5).replace('-', '/') : label
        return (
          <g key={label}>
            <rect
              x={x}
              y={y}
              width={BAR_W}
              height={barH}
              fill={count > 0 ? '#dc2626' : '#e5e7eb'}
              rx="2"
            />
            {count > 0 && (
              <text
                x={x + BAR_W / 2}
                y={y - 3}
                textAnchor="middle"
                fontSize="8"
                fill="#374151"
                fontFamily="system-ui, sans-serif"
              >
                {count}
              </text>
            )}
            {showLabel && (
              <text
                x={x + BAR_W / 2}
                y={CHART_H + LABEL_H - 4}
                textAnchor="middle"
                fontSize="8"
                fill="#9ca3af"
                fontFamily="system-ui, sans-serif"
              >
                {displayLabel}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

type DaysParam = '7' | '30' | '90' | 'all'

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>
}) {
  const { days: daysRaw } = await searchParams
  const VALID = new Set<string>(['7', '30', '90', 'all'])
  const days: DaysParam = (daysRaw && VALID.has(daysRaw) ? daysRaw : '30') as DaysParam

  const since = days === 'all' ? null : daysAgoIso(Number(days))

  const db = getAdminClient()

  let eventsQuery = db
    .from('analytics_events')
    .select('type, product_id, term')
    .order('created_at', { ascending: false })
    .limit(FETCH_CAP)

  let ordersQuery = db
    .from('order_requests')
    .select('id, created_at, status, subtotal_cents')
    .order('created_at', { ascending: true })

  if (since) {
    eventsQuery = eventsQuery.gte('created_at', since)
    ordersQuery = ordersQuery.gte('created_at', since)
  }

  const [eventsResult, ordersResult] = await Promise.all([eventsQuery, ordersQuery])

  const tableMissing = !!eventsResult.error
  const events = (eventsResult.data ?? []) as EventRow[]
  const orders = (ordersResult.data ?? []) as OrderRow[]

  const views = events.filter((e) => e.type === 'view')
  const searches = events.filter((e) => e.type === 'search')

  const topProducts = topCounts(views.map((e) => e.product_id), 20)
  const topSearches = topCounts(searches.map((e) => e.term), 20)

  let nameById = new Map<string, { name: string; sku: string | null }>()
  if (topProducts.length > 0) {
    const { data: prods } = await db
      .from('products')
      .select('id, name, sku')
      .in('id', topProducts.map((p) => p.key))
    nameById = new Map((prods ?? []).map((p) => [p.id, { name: p.name, sku: p.sku }]))
  }

  // Build chart buckets
  let chartLabels: string[]
  let chartCounts: Record<string, number>

  if (days === 'all') {
    const earliestDate = orders.length > 0 ? orders[0].created_at.slice(0, 10) : new Date().toISOString().slice(0, 10)
    const { labels, counts } = buildWeeklyBuckets(earliestDate)
    chartLabels = labels
    chartCounts = counts
    for (const o of orders) {
      const weekLabel = weekLabelFor(o.created_at)
      if (weekLabel in chartCounts) chartCounts[weekLabel]++
    }
  } else {
    const { labels, counts } = buildDailyBuckets(Number(days))
    chartLabels = labels
    chartCounts = counts
    for (const o of orders) {
      const key = o.created_at.slice(0, 10)
      if (key in chartCounts) chartCounts[key]++
    }
  }

  // Fetch order items for the same window to power the top-ordered-products table
  let orderItems: OrderItemRow[] = []
  if (orders.length > 0) {
    const orderIds = orders.map((o) => o.id)
    const { data: itemsData } = await db
      .from('order_items')
      .select('product_id, name, sku, qty, line_total_cents')
      .in('order_id', orderIds)
    orderItems = (itemsData ?? []) as OrderItemRow[]
  }

  const productTotals = new Map<string, { name: string; sku: string; qty: number; revenue: number }>()
  for (const item of orderItems) {
    const existing = productTotals.get(item.product_id)
    if (existing) {
      existing.qty += item.qty
      existing.revenue += item.line_total_cents
    } else {
      productTotals.set(item.product_id, { name: item.name, sku: item.sku, qty: item.qty, revenue: item.line_total_cents })
    }
  }
  const topOrdered = [...productTotals.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 20)

  const totalOrders = orders.length
  const totalRevenueCents = orders.reduce((sum, o) => sum + (o.subtotal_cents ?? 0), 0)
  const avgOrderCents = totalOrders > 0 ? Math.round(totalRevenueCents / totalOrders) : 0
  const convertedCount = orders.filter((o) => o.status === 'converted').length
  const conversionRate = totalOrders > 0 ? Math.round((convertedCount / totalOrders) * 100) : 0

  const statusCounts = { new: 0, contacted: 0, converted: 0, cancelled: 0 }
  for (const o of orders) {
    if (o.status in statusCounts) statusCounts[o.status as keyof typeof statusCounts]++
  }

  const chartSubheading = days === 'all' ? 'All time' : `Last ${days} days`

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-10">
        <div className="mb-6">
          <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            ← Back to Dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">Analytics</h1>
        </div>

        {/* Date range filter */}
        <div className="mb-6 flex gap-2">
          {(['7', '30', '90', 'all'] as const).map((d) => (
            <Link
              key={d}
              href={`?days=${d}`}
              className={
                days === d
                  ? 'rounded-full bg-red-600 px-4 py-1.5 text-sm font-medium text-white'
                  : 'rounded-full border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-600 hover:border-gray-400'
              }
            >
              {d === 'all' ? 'All time' : `${d}D`}
            </Link>
          ))}
        </div>

        {/* Orders over time */}
        <section className="mb-8 rounded-xl bg-white border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Orders over time</h2>
            <Link href="/admin/orders" className="text-xs text-red-600 hover:text-red-700 font-medium">
              View all orders →
            </Link>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-4 divide-x divide-gray-100 border-b border-gray-100">
            <div className="px-4 py-3">
              <p className="text-xs text-gray-500">Total orders</p>
              <p className="text-xl font-bold text-gray-900">{totalOrders.toLocaleString()}</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs text-gray-500">Quote value</p>
              <p className="text-xl font-bold text-gray-900">{formatDollars(totalRevenueCents)}</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs text-gray-500">Avg order</p>
              <p className="text-xl font-bold text-gray-900">{formatDollars(avgOrderCents)}</p>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs text-gray-500">Converted</p>
              <p className="text-xl font-bold text-gray-900">
                {convertedCount}
                <span className="ml-1 text-sm font-normal text-gray-400">{conversionRate}%</span>
              </p>
            </div>
          </div>

          {/* Status funnel */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 text-sm">
            <span className="text-xs text-gray-400 uppercase tracking-wide font-medium">Pipeline</span>
            {([
              { key: 'new', label: 'New', color: 'bg-blue-100 text-blue-700' },
              { key: 'contacted', label: 'Contacted', color: 'bg-yellow-100 text-yellow-700' },
              { key: 'converted', label: 'Converted', color: 'bg-green-100 text-green-700' },
              { key: 'cancelled', label: 'Cancelled', color: 'bg-gray-100 text-gray-500' },
            ] as const).map(({ key, label, color }) => (
              <span key={key} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${color}`}>
                {label} {statusCounts[key]}
              </span>
            ))}
          </div>

          {/* Bar chart */}
          <div className="px-4 pt-4 pb-2">
            <p className="mb-2 text-xs text-gray-400">{chartSubheading}</p>
            {totalOrders === 0 ? (
              <p className="py-6 text-center text-sm text-gray-400">No orders in this period.</p>
            ) : (
              <BarChart labels={chartLabels} counts={chartCounts} />
            )}
          </div>
        </section>

        {tableMissing ? (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            Catalog analytics isn&apos;t set up yet. Run{' '}
            <code className="font-mono">supabase/migrations/0003_analytics_events.sql</code> in the Supabase
            SQL editor, then product views and searches will be tracked here automatically.
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
                        <Link
                          href={`/product/${p.key}`}
                          className="min-w-0 truncate text-sm text-gray-800 hover:text-red-600"
                        >
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
                      <Link
                        href={`/?q=${encodeURIComponent(s.key)}`}
                        className="min-w-0 truncate text-sm text-gray-800 hover:text-red-600"
                      >
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

            {/* Top ordered products */}
            <section className="mt-6 rounded-xl bg-white border border-gray-200 overflow-hidden">
              <h2 className="px-4 py-3 text-sm font-semibold uppercase tracking-wide text-gray-500 border-b border-gray-100">
                Top ordered products
              </h2>
              {topOrdered.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-gray-400">No orders in this period.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-400">
                      <th className="px-4 py-2 text-left font-medium">Product</th>
                      <th className="px-4 py-2 text-right font-medium">Units</th>
                      <th className="px-4 py-2 text-right font-medium">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {topOrdered.map((p) => (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2.5">
                          <Link href={`/product/${p.id}`} className="font-medium text-gray-800 hover:text-red-600">
                            {p.name}
                          </Link>
                          {p.sku && <span className="ml-2 text-xs text-gray-400">{p.sku}</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{p.qty.toLocaleString()}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600">{formatDollars(p.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

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
