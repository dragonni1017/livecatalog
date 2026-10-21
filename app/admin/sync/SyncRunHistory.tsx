import Link from 'next/link'
import { syncHealth, uncategorizedFromDetails, type SyncRunRow } from '@/lib/sync-runs'

// Recent Erply sync runs (migration 0061). Server component; the page passes
// the rows in.

type Run = SyncRunRow & { id: number }

const BADGE: Record<SyncRunRow['status'], string> = {
  ok: 'bg-green-100 text-green-700',
  partial: 'bg-amber-100 text-amber-800',
  error: 'bg-red-100 text-red-700',
  skipped: 'bg-gray-100 text-gray-600',
}

function when(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function subErrors(details: Record<string, unknown> | null): string[] {
  return Object.entries(details ?? {})
    .filter(([, v]) => !!v && typeof v === 'object' && 'error' in (v as object))
    .map(([k, v]) => `${k}: ${String((v as { error: unknown }).error).slice(0, 200)}`)
}

export default function SyncRunHistory({ runs, loadFailed }: { runs: Run[]; loadFailed: boolean }) {
  if (loadFailed) {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Couldn&apos;t load sync history. If this is a new install, run{' '}
        <code className="font-mono">supabase/migrations/0061_sync_runs.sql</code>.
      </p>
    )
  }
  const health = syncHealth(runs)
  const tone =
    health.level === 'ok'
      ? 'border-green-200 bg-green-50 text-green-800'
      : health.level === 'warning'
        ? 'border-red-200 bg-red-50 text-red-800'
        : 'border-gray-200 bg-white text-gray-600'

  return (
    <section className="mt-8">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">Run history</h2>
      <p className={`mb-3 rounded-lg border px-4 py-2.5 text-sm ${tone}`} data-sync-health={health.level}>
        {health.message} The nightly run is at 1 AM Pacific.
      </p>
      {runs.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2">When (PT)</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Updated</th>
                <th className="px-3 py-2 text-right">New</th>
                <th className="px-3 py-2 text-right">Deactivated</th>
                <th className="px-3 py-2 text-right">Errors</th>
                <th className="px-3 py-2 text-right">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {runs.map((r) => {
                const problems = [...(r.message ? [r.message] : []), ...subErrors(r.details), ...(r.errors ?? []).map((e) => `${e.sku ?? `row ${e.row}`}: ${e.message}`)]
                const uncategorized = uncategorizedFromDetails(r.details)
                return (
                  <tr key={r.id} className="align-top">
                    <td className="whitespace-nowrap px-3 py-2 text-gray-700">{when(r.started_at)}</td>
                    <td className="px-3 py-2 text-gray-500">{r.source === 'cron' ? 'Nightly' : 'Manual'}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[r.status]}`}>{r.status}</span>
                      {problems.length > 0 && (
                        <details className="mt-1 text-xs text-gray-600">
                          <summary className="cursor-pointer text-red-700">
                            {problems.length} issue{problems.length === 1 ? '' : 's'}
                            {r.error_count > (r.errors?.length ?? 0) ? ` (first ${r.errors?.length} of ${r.error_count} errors shown)` : ''}
                          </summary>
                          <ul className="mt-1 max-w-xl list-disc space-y-0.5 pl-4">
                            {problems.slice(0, 60).map((p, i) => (
                              <li key={i} className="break-words">{p}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {/* Not an error -- the run worked -- but these products are
                          on no category page until someone files them. */}
                      {uncategorized && (
                        <details className="mt-1 text-xs text-gray-600" data-sync-uncategorized={uncategorized.count}>
                          <summary className="cursor-pointer text-amber-700">
                            {uncategorized.count} new product{uncategorized.count === 1 ? '' : 's'} with no matching category
                          </summary>
                          <ul className="mt-1 max-w-xl list-disc space-y-0.5 pl-4">
                            {uncategorized.sample.map((u) => (
                              <li key={u.sku} className="break-words">
                                <span className="font-mono">{u.sku}</span>
                                {u.category ? <> (Erply group &ldquo;{u.category}&rdquo;)</> : ' (no Erply group)'}
                              </li>
                            ))}
                            {uncategorized.count > uncategorized.sample.length && (
                              <li className="text-gray-400">…and {uncategorized.count - uncategorized.sample.length} more</li>
                            )}
                          </ul>
                          <p className="mt-1 max-w-xl text-gray-500">
                            Set their category on the{' '}
                            <Link href="/admin/cleanup?issue=category" className="text-red-700 underline">
                              No category
                            </Link>{' '}
                            tab, and add the group to lib/erply-category-aliases.ts so the next ones match.
                          </p>
                        </details>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.updated.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.inserted.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.deactivated.toLocaleString()}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${r.error_count ? 'font-semibold text-red-700' : ''}`}>{r.error_count}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500">{(r.duration_ms / 1000).toFixed(1)}s</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
