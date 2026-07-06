import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface EventRow {
  term: string | null
  created_at: string
}

interface QueryStat {
  query: string
  count: number
  last_seen: string
}

function formatDate(isoStr: string): string {
  const d = new Date(isoStr)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default async function ZeroResultsPage() {
  const db = getAdminClient()
  // Zero-result searches are stored as type='search' with term prefixed '[no_results] '
  // (to stay within the DB check constraint on the type column)
  const { data } = await db
    .from('analytics_events')
    .select('term, created_at')
    .eq('type', 'search')
    .like('term', '[no_results] %')
    .not('term', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1000)

  const PREFIX = '[no_results] '
  const rows = (data ?? []) as EventRow[]

  // Aggregate by query (case-insensitive, trimmed) — strip the prefix first
  const map = new Map<string, QueryStat>()
  for (const row of rows) {
    if (!row.term) continue
    const stripped = row.term.startsWith(PREFIX) ? row.term.slice(PREFIX.length) : row.term
    const key = stripped.toLowerCase().trim()
    if (!key) continue
    const existing = map.get(key)
    if (existing) {
      existing.count++
      if (row.created_at > existing.last_seen) {
        existing.last_seen = row.created_at
      }
    } else {
      map.set(key, { query: stripped.trim(), count: 1, last_seen: row.created_at })
    }
  }

  const stats: QueryStat[] = [...map.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 100)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="mb-6">
          <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            ← Back to Dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">Zero-Result Searches</h1>
          <p className="mt-1 text-sm text-gray-500">
            Search terms that returned no products — these may be catalog gaps or typos.
          </p>
        </div>

        {/* Summary chips */}
        <div className="mb-6 flex flex-wrap gap-3 text-sm">
          <span className="rounded-lg bg-white border border-gray-200 px-4 py-2 text-gray-700">
            <span className="font-semibold text-gray-900">{stats.length}</span> unique queries
          </span>
          <span className="rounded-lg bg-white border border-gray-200 px-4 py-2 text-gray-500">
            All time
          </span>
        </div>

        {/* Table card */}
        {stats.length === 0 ? (
          <div className="rounded-xl bg-white border border-gray-200 px-6 py-12 text-center">
            <p className="text-sm text-gray-400">
              No zero-result searches recorded yet. They&apos;ll appear here once the search
              autosuggest is active.
            </p>
          </div>
        ) : (
          <section className="rounded-xl bg-white border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Search Term
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Times Searched
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Last Searched
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {stats.map((s) => (
                  <tr key={s.query} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-gray-800">&quot;{s.query}&quot;</span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-semibold text-gray-900">
                      {s.count}
                    </td>
                    <td className="px-4 py-2.5 text-right text-gray-500">
                      {formatDate(s.last_seen)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}
      </div>
    </div>
  )
}
