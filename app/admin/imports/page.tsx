import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface ImportRun {
  id: string
  source: string
  rows_received: number
  inserted: number
  updated: number
  deactivated: number
  skipped: number
  error_count: number
  created_at: string
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export default async function AdminImportsPage() {
  const db = getAdminClient()
  const { data, error } = await db
    .from('import_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)

  // Table may not exist yet (migration 0002 not run) — degrade gracefully.
  const tableMissing = !!error
  const runs = (data ?? []) as ImportRun[]

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-10">
        <div className="mb-6">
          <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            ← Back to Dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">Import History</h1>
        </div>

        {tableMissing ? (
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            Import history isn’t set up yet. Run <code className="font-mono">supabase/migrations/0002_import_runs.sql</code> in
            the Supabase SQL editor, then imports will be logged here automatically.
          </div>
        ) : (
          <div className="rounded-xl bg-white border border-gray-200 overflow-hidden">
            <div className="overflow-auto max-h-[640px]">
              <table className="w-full text-sm text-left">
                <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">When</th>
                    <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Source</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Rows</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-green-600 uppercase tracking-wide">New</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-amber-600 uppercase tracking-wide">Updated</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Deactivated</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Skipped</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-red-600 uppercase tracking-wide">Errors</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {runs.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-3 text-gray-700">{formatDate(r.created_at)}</td>
                      <td className="px-4 py-3 text-gray-500">{r.source}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{r.rows_received.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-medium text-green-700">{r.inserted}</td>
                      <td className="px-4 py-3 text-right font-medium text-amber-700">{r.updated}</td>
                      <td className="px-4 py-3 text-right text-gray-600">{r.deactivated}</td>
                      <td className="px-4 py-3 text-right text-gray-400">{r.skipped}</td>
                      <td className={`px-4 py-3 text-right font-medium ${r.error_count > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                        {r.error_count}
                      </td>
                    </tr>
                  ))}
                  {runs.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">
                        No imports recorded yet. Run an Excel import to see it here.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
