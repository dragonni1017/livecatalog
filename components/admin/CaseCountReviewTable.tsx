'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { readApiError } from '@/lib/admin-fetch'
import { caseCountOptions, withCaseCount, type CaseCountEvidence } from '@/lib/case-count-review'

export interface CaseCountReviewRow {
  id: string
  batch: string
  sku: string
  current_name: string
  current_case_pieces: number | null
  evidence: CaseCountEvidence[]
  reason: string
  status: 'pending' | 'approved' | 'skipped'
  decided_name: string | null
  result: string | null
  product: { id: string; name: string; sold_by: string | null; manually_hidden: boolean | null } | null
}

function Row({ row }: { row: CaseCountReviewRow }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const options = useMemo(() => caseCountOptions(row.evidence, row.current_case_pieces), [row])

  async function send(body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/admin/api/case-count-review', {
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
        <div className="mt-1 text-xs text-gray-400">
          {row.product?.sold_by ? `sold by ${row.product.sold_by}` : ''}
          {row.product?.manually_hidden ? ' · hidden' : ''}
        </div>
      </td>
      <td className="px-3 py-3 text-sm text-gray-800">
        {row.current_name}
        <div className="mt-1 text-xs font-semibold text-gray-700">
          Name says {row.current_case_pieces ?? '?'} per case
        </div>
        {moved && <div className="mt-1 text-xs text-amber-700">Now: {row.product!.name}</div>}
      </td>
      <td className="px-3 py-3 text-xs text-gray-700">
        <ul className="space-y-1">
          {row.evidence.map((e, i) => (
            <li key={i}>
              <span className="font-semibold">{e.source}:</span>{' '}
              {e.count != null && <span className="font-semibold text-gray-900">{e.count}</span>} {e.detail}
            </li>
          ))}
        </ul>
        {row.reason && <div className="mt-1 text-gray-500">{row.reason}</div>}
      </td>
      <td className="px-3 py-3">
        {row.status === 'pending' ? (
          <div className="flex flex-col gap-1.5">
            {options.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {options.map((o) => {
                  const next = withCaseCount(row.current_name, o.count)
                  return (
                    <button
                      key={o.count}
                      onClick={() => next && setName(next)}
                      disabled={busy || !next}
                      title={next ? next : 'Not a whole number of packs; type the name instead'}
                      className="rounded-md border border-gray-300 bg-white px-2 py-0.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                    >
                      Use {o.count} ({o.sources.join(', ')})
                    </button>
                  )
                })}
              </div>
            )}
            <textarea
              value={name}
              onChange={(e) => setName(e.target.value)}
              rows={2}
              placeholder="Pick a count above or type the new name"
              disabled={busy}
              className="w-full min-w-[18rem] rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
            />
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => send({ action: 'approve', name })}
                disabled={busy || !name.trim()}
                className="rounded-md bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                {busy ? 'Renaming…' : 'Change case count'}
              </button>
              <button
                onClick={() => send({ action: 'skip' })}
                disabled={busy}
                className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Name is right
              </button>
            </div>
            {error && <div className="text-xs text-red-600">{error}</div>}
            {!error && row.result && <div className="text-xs text-amber-700">Last try: {row.result}</div>}
          </div>
        ) : row.status === 'approved' ? (
          <div className="text-sm">
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">Changed</span>
            <div className="mt-1 text-gray-800">{row.decided_name}</div>
            {row.result && <div className="mt-1 text-xs text-gray-500">{row.result}</div>}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600">Kept</span>
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

export default function CaseCountReviewTable({ rows }: { rows: CaseCountReviewRow[] }) {
  const [view, setView] = useState<'pending' | 'approved' | 'skipped'>('pending')
  const counts = useMemo(() => ({
    pending: rows.filter((r) => r.status === 'pending').length,
    approved: rows.filter((r) => r.status === 'approved').length,
    skipped: rows.filter((r) => r.status === 'skipped').length,
  }), [rows])
  const shown = rows.filter((r) => r.status === view)

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(['pending', 'approved', 'skipped'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={'rounded-md px-3 py-1.5 text-sm font-semibold ' + (view === v ? 'bg-red-600 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50')}
          >
            {v === 'pending' ? 'To decide' : v === 'approved' ? 'Changed' : 'Kept'} ({counts[v]})
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-left">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-3">SKU</th>
              <th className="px-3 py-3">Current name</th>
              <th className="px-3 py-3">What the sources say (pieces per case)</th>
              <th className="px-3 py-3">Decision</th>
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
