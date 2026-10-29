'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { readApiError } from '@/lib/admin-fetch'
import { parseDollars } from '@/lib/price-review'

export interface ReviewRow {
  id: string
  batch: string
  sku: string
  grp: string
  note: string
  reason: string
  file_cents: number | null
  website_cents: number | null
  suggested_cents: number | null
  status: 'pending' | 'approved' | 'skipped'
  decided_cents: number | null
  decided_at: string | null
  product: { id: string; name: string; stock_qty: number; price_cents: number; held_price_cents: number | null } | null
}

const money = (c: number | null | undefined) => (c == null ? '—' : `$${(c / 100).toFixed(2)}`)

function Row({ row }: { row: ReviewRow }) {
  const router = useRouter()
  const [price, setPrice] = useState(row.suggested_cents != null ? (row.suggested_cents / 100).toFixed(2) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/admin/api/price-review', {
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

  function approve() {
    const cents = parseDollars(price)
    if (cents == null || cents <= 0) return setError('Enter a price like 12.50.')
    send({ action: 'approve', cents })
  }

  const p = row.product
  const now = p?.price_cents ?? row.website_cents
  return (
    <tr className="align-top">
      <td className="px-3 py-3">
        <div className="font-mono text-xs font-semibold text-gray-900">{row.sku}</div>
        <div className="mt-0.5 max-w-xs text-xs text-gray-600">{p?.name ?? '(product missing)'}</div>
        <div className="mt-1 text-xs text-gray-400">{row.grp}</div>
      </td>
      <td className="px-3 py-3 text-right text-sm tabular-nums text-gray-700">{p ? p.stock_qty.toLocaleString() : '—'}</td>
      <td className="px-3 py-3 text-right text-sm tabular-nums font-semibold text-gray-900">{money(now)}</td>
      <td className="px-3 py-3 text-right text-sm tabular-nums text-gray-600">{money(row.file_cents)}</td>
      <td className="px-3 py-3 text-xs text-gray-700">
        <div>{row.reason}</div>
        {row.note && <div className="mt-1 text-gray-500">Note: {row.note}</div>}
      </td>
      <td className="px-3 py-3">
        {row.status === 'pending' ? (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-gray-500">$</span>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && approve()}
                inputMode="decimal"
                placeholder="0.00"
                disabled={busy}
                className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm tabular-nums focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              />
              <button
                onClick={approve}
                disabled={busy || !price.trim()}
                className="rounded-md bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                {busy ? '…' : 'Approve'}
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
          </div>
        ) : row.status === 'approved' ? (
          <div className="text-sm">
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">Approved {money(row.decided_cents)}</span>
            <div className="mt-1 text-xs text-gray-500">
              {p?.held_price_cents != null ? 'Held until Erply matches' : 'Erply matches now'}
            </div>
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

export default function PriceReviewTable({ rows }: { rows: ReviewRow[] }) {
  const [view, setView] = useState<'pending' | 'approved' | 'skipped'>('pending')
  const [group, setGroup] = useState('all')
  const counts = useMemo(() => ({
    pending: rows.filter((r) => r.status === 'pending').length,
    approved: rows.filter((r) => r.status === 'approved').length,
    skipped: rows.filter((r) => r.status === 'skipped').length,
  }), [rows])
  const groups = useMemo(() => [...new Set(rows.filter((r) => r.status === view).map((r) => r.grp))].sort(), [rows, view])
  const shown = rows.filter((r) => r.status === view && (group === 'all' || r.grp === group))

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(['pending', 'approved', 'skipped'] as const).map((v) => (
          <button
            key={v}
            onClick={() => { setView(v); setGroup('all') }}
            className={'rounded-md px-3 py-1.5 text-sm font-semibold ' + (view === v ? 'bg-red-600 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50')}
          >
            {v === 'pending' ? 'To decide' : v === 'approved' ? 'Approved' : 'Skipped'} ({counts[v]})
          </button>
        ))}
        <select
          value={group}
          onChange={(e) => setGroup(e.target.value)}
          className="ml-2 rounded-md border border-gray-300 bg-white py-1.5 pl-2 pr-7 text-sm text-gray-900"
        >
          <option value="all">All groups</option>
          {groups.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-left">
          <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-3 py-3">Product</th>
              <th className="px-3 py-3 text-right">Stock</th>
              <th className="px-3 py-3 text-right">Website now</th>
              <th className="px-3 py-3 text-right">From file</th>
              <th className="px-3 py-3">Why this suggestion</th>
              <th className="px-3 py-3">Website price</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {shown.map((r) => <Row key={r.id} row={r} />)}
            {shown.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">Nothing here.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
