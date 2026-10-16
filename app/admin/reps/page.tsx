import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'
import { groupByRep, periodSince, summarize, type AttributableOrder, type RepSummary } from '@/lib/rep-attribution'
import { loadRepAccounts } from '@/lib/rep-accounts'

export const dynamic = 'force-dynamic'

// Rep performance: one row per rep ACCOUNT, crediting orders by the rule in
// lib/rep-attribution.ts (dropdown/?rep= email, else the signed-in rep).
// Older free-text names that match no account are listed separately.

function dollars(cents: number): string {
  return '$' + Math.round(cents / 100).toLocaleString('en-US')
}

function day(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' })
}

const PERIODS = [
  { key: '30', label: '30 days' },
  { key: '90', label: '90 days' },
  { key: '365', label: '12 months' },
  { key: 'all', label: 'All time' },
] as const

export default async function RepPerformancePage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const { key: period, since } = periodSince((await searchParams).days)
  const db = getAdminClient()

  let q = db
    .from('order_requests')
    .select('id, reference_code, created_at, status, subtotal_cents, placed_by_rep, rep_user_id')
    .order('created_at', { ascending: false })
  if (since) q = q.gte('created_at', since)
  const [{ data: orderData, error }, reps] = await Promise.all([q, loadRepAccounts(db)])
  const orders = (orderData ?? []) as AttributableOrder[]

  const { byRep, unlinked } = groupByRep(orders, reps)
  const rows = reps
    .map((r) => ({ rep: r, s: summarize(byRep.get(r.id) ?? []) }))
    .sort((a, b) => b.s.quoteValueCents - a.s.quoteValueCents || a.rep.email.localeCompare(b.rep.email))
  const unlinkedRows = [...unlinked.entries()].map(([name, list]) => ({ name, s: summarize(list) }))
  const repOrders = rows.reduce((n, r) => n + r.s.orders, 0)

  return (
    <RepPerformanceView
      period={period}
      reps={reps.length}
      repOrders={repOrders}
      totalOrders={orders.length}
      rows={rows.map((r) => ({ key: r.rep.id, label: r.rep.email, s: r.s }))}
      unlinkedRows={unlinkedRows.map((r) => ({ key: r.name, label: r.name, s: r.s }))}
      loadFailed={!!error}
    />
  )
}

function Row({ label, s, mono }: { label: string; s: RepSummary; mono?: boolean }) {
  return (
    <tr className={s.orders === 0 ? 'text-gray-400' : undefined}>
      <td className={`px-4 py-3 ${mono ? 'font-mono text-xs break-all' : ''}`}>{label}</td>
      <td className="px-4 py-3 text-right tabular-nums">{s.orders}</td>
      <td className="px-4 py-3 text-right tabular-nums font-medium">{dollars(s.quoteValueCents)}</td>
      <td className="px-4 py-3 text-right tabular-nums">
        {s.open > 0 ? (
          <span className="text-amber-700">
            {s.open} · {dollars(s.openValueCents)}
          </span>
        ) : (
          '0'
        )}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {s.converted}
        {s.converted > 0 && <span className="ml-1 text-xs text-gray-500">({dollars(s.convertedValueCents)})</span>}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">{s.orders ? `${Math.round((s.converted / s.orders) * 100)}%` : '—'}</td>
      <td className="whitespace-nowrap px-4 py-3 text-right text-gray-500">{day(s.lastOrderAt)}</td>
    </tr>
  )
}

function Head() {
  return (
    <tr className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
      <th className="px-4 py-3 text-left">Rep</th>
      <th className="px-4 py-3 text-right">Quotes</th>
      <th className="px-4 py-3 text-right">Quote value</th>
      <th className="px-4 py-3 text-right">Open</th>
      <th className="px-4 py-3 text-right">Converted</th>
      <th className="px-4 py-3 text-right">Rate</th>
      <th className="px-4 py-3 text-right">Last quote</th>
    </tr>
  )
}

interface ViewRow {
  key: string
  label: string
  s: RepSummary
}

function RepPerformanceView({
  period,
  reps,
  repOrders,
  totalOrders,
  rows,
  unlinkedRows,
  loadFailed,
}: {
  period: string
  reps: number
  repOrders: number
  totalOrders: number
  rows: ViewRow[]
  unlinkedRows: ViewRow[]
  loadFailed: boolean
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-5xl px-4 py-10">
        <Link href="/admin" className="mb-6 inline-flex items-center text-sm text-gray-500 hover:text-gray-700">
          ← Back to Dashboard
        </Link>
        <div className="mb-1 flex items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">Rep Performance</h1>
          <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
            {reps} rep account{reps !== 1 ? "s" : ""}
          </span>
        </div>
        <p className="mb-4 text-sm text-gray-500">
          {repOrders} of {totalOrders} quotes in this period credited to a rep. A quote is credited to the rep chosen in
          &quot;Placed by (rep)&quot; (or their ?rep= link), else to the rep signed in when it was placed. &quot;Open&quot; = new or
          contacted.
        </p>
        <div className="mb-6 flex gap-2">
          {PERIODS.map((p) => (
            <Link
              key={p.key}
              href={p.key === 'all' ? '?' : `?days=${p.key}`}
              className={
                period === p.key
                  ? 'rounded-full bg-red-600 px-4 py-1.5 text-sm font-medium text-white'
                  : 'rounded-full border border-gray-300 px-4 py-1.5 text-sm font-medium text-gray-600 hover:border-gray-400'
              }
            >
              {p.label}
            </Link>
          ))}
        </div>

        {loadFailed ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Couldn&apos;t load orders.</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
              <table className="w-full text-sm text-gray-800">
                <thead><Head /></thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((r) => (
                    <Row key={r.key} label={r.label} s={r.s} mono />
                  ))}
                </tbody>
              </table>
            </div>

            {unlinkedRows.length > 0 && (
              <div className="mt-8">
                <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-500">Names with no rep account</h2>
                <p className="mb-3 text-sm text-gray-500">
                  Typed as free text on older orders (before the rep dropdown), so they can&apos;t be matched to an account automatically.
                </p>
                <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
                  <table className="w-full text-sm text-gray-800">
                    <thead><Head /></thead>
                    <tbody className="divide-y divide-gray-100">
                      {unlinkedRows.map((r) => (
                        <Row key={r.key} label={r.label} s={r.s} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
