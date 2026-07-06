import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface RepStats {
  rep: string
  orders: number
  totalCents: number
  converted: number
}

function formatDollars(cents: number): string {
  return '$' + Math.round(cents / 100).toLocaleString('en-US')
}

export default async function RepPerformancePage() {
  const db = getAdminClient()

  const { data } = await db
    .from('order_requests')
    .select('placed_by_rep, status, subtotal_cents')
    .not('placed_by_rep', 'is', null)
    .neq('placed_by_rep', '')

  const map = new Map<string, RepStats>()

  for (const row of data ?? []) {
    const rep = row.placed_by_rep as string
    const existing = map.get(rep) ?? { rep, orders: 0, totalCents: 0, converted: 0 }
    existing.orders += 1
    existing.totalCents += row.subtotal_cents ?? 0
    if (row.status === 'converted') existing.converted += 1
    map.set(rep, existing)
  }

  const reps = Array.from(map.values()).sort((a, b) => b.totalCents - a.totalCents)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-10">
        {/* Back link */}
        <Link
          href="/admin"
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700 transition-colors mb-6"
        >
          <svg
            className="w-4 h-4 mr-1"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Dashboard
        </Link>

        {/* Header */}
        <div className="flex items-center gap-3 mb-1">
          <h1 className="text-2xl font-bold text-gray-900">Rep Performance</h1>
          <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
            {reps.length} rep{reps.length !== 1 ? 's' : ''}
          </span>
        </div>
        <p className="text-sm text-gray-500 mb-8">All time · orders placed via rep link</p>

        {/* Table */}
        {reps.length === 0 ? (
          <div className="rounded-xl bg-white border border-gray-200 px-6 py-10 shadow-sm text-center text-sm text-gray-500">
            No rep-attributed orders yet. Orders placed via a{' '}
            <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs">?rep=</code>{' '}
            link will appear here.
          </div>
        ) : (
          <div className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Rep
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Orders
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Total Value
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Converted
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Conv. Rate
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {reps.map((r) => (
                  <tr key={r.rep} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 font-mono text-xs text-gray-700 break-all">
                      {r.rep}
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-gray-700">
                      {r.orders}
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-gray-900 font-medium">
                      {formatDollars(r.totalCents)}
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums text-gray-700">
                      {r.converted}
                    </td>
                    <td className="px-6 py-4 text-right tabular-nums">
                      <span
                        className={
                          r.converted > 0
                            ? 'text-green-700 font-medium'
                            : 'text-gray-400'
                        }
                      >
                        {Math.round((r.converted / r.orders) * 100)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
