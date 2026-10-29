'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { readApiError } from '@/lib/admin-fetch'

export interface NameReviewRow {
  id: string
  batch: string
  sku: string
  problem: string
  reason: string
  current_name: string
  suggested_name: string | null
  status: 'pending' | 'approved' | 'skipped'
  decided_name: string | null
  result: string | null
  product: { id: string; name: string } | null
}

function Row({ row }: { row: NameReviewRow }) {
  const router = useRouter()
  const [name, setName] = useState(row.suggested_name ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/admin/api/name-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, ...body }),
      })
      const err = await readApiError(res, 'Could not save.')
      if (err) return setError(err)
      router.refresh()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  // The catalog name moved since this row was loaded: the rename will be refused.
  const moved = row.status === 'pending' && row.product && row.product.name !== row.current_name

  return (
    <tr className="align-top">
      <td className="px-3 py-3">
        <div className="font-mono text-xs font-semibold text-gray-900">{row.sku}</div>
        <div className="mt-1 text-xs text-gray-400">{row.problem}</div>
      </td>
      <td className="px-3 py-3 text-sm text-gray-800">
        {row.current_name}
        {moved && <div className="mt-1 text-xs text-amber-700">Now: {row.product!.name}</div>}
      </td>
      <td className="px-3 py-3 text-xs text-gray-600">{row.reason}</td>
      <td className="px-3 py-3">
        {row.status === 'pending' ? (
          <div className="flex flex-col gap-1.5">
            <textarea
              value={name}
              onChange={(e) => setName(e.target.value)}
              rows={2}
              placeholder="Type the new name"
              disabled={busy}
              className="w-full min-w-[18rem] rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
            />
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => send({ action: 'approve', name })}
                disabled={busy || !name.trim()}
                className="rounded-md bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                {busy ? 'Renaming…' : 'Rename'}
              </button>
              <button
                onClick={() => send({ action: 'skip' })}
                disabled={busy}
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Skip
              </button>
            </div>
            {error && <div className="text-xs text-red-600">{error}</div>}
            {!error && row.result && <div className="text-xs text-amber-700">Last try: {row.result}</div>}
          </div>
        ) : row.status === 'approved' ? (
          <div className="text-sm">
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">Renamed</span>
            <div className="mt-1 text-gray-800">{row.decided_name}</div>
            {row.result && <div className="mt-1 text-xs text-gray-500">{row.result}</div>}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">Skipped</span>
            <button onClick={() => send({ action: 'reopen' })} disabled={busy} className="text-xs text-red-600 hover:underline disabled:opacity-50">
              Reopen
            </button>
            {error && <span className="text-xs text-red-600">{error}</span>}
          </div>
        )}
      </td>
    </tr>
  )
}

export default function NameReviewTable({ rows }: { rows: NameReviewRow[] }) {
  const [view, setView] = useState<'pending' | 'approved' | 'skipped'>('pending')
  const [problem, setProblem] = useState('all')
  const counts = useMemo(() => ({
    pending: rows.filter((r) => r.status === 'pending').length,
    approved: rows.filter((r) => r.status === 'approved').length,
    skipped: rows.filter((r) => r.status === 'skipped').length,
  }), [rows])
  const problems = useMemo(() => [...new Set(rows.filter((r) => r.status === view).map((r) => r.problem))].sort(), [rows, view])
  const shown = rows.filter((r) => r.status === view && (problem === 'all' || r.problem === problem))

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(['pending', 'approved', 'skipped'] as const).map((v) => (
          <button
            key={v}
            onClick={() => { setView(v); setProblem('all') }}
            className={'rounded-md px-3 py-1.5 text-sm font-semibold ' + (view === v ? 'bg-red-600 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50')}
          >
            {v === 'pending' ? 'To decide' : v === 'approved' ? 'Renamed' : 'Skipped'} ({counts[v]})
          </button>
        ))}
        <select
          value={problem}
          onChange={(e) => setProblem(e.target.value)}
          className="ml-2 rounded-md border border-gray-300 bg-white py-1.5 pl-2 pr-7 text-sm text-gray-900"
        >
          <option value="all">All problems</option>
          {problems.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-left">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-3">SKU</th>
              <th className="px-3 py-3">Current name</th>
              <th className="px-3 py-3">What we found</th>
              <th className="px-3 py-3">New name</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {shown.map((r) => <Row key={r.id} row={r} />)}
            {shown.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-gray-400">Nothing here.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
