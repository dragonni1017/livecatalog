'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { StockAdjustment } from '@/lib/types'

interface Props {
  id: string
  name: string
  stockQty: number
}

export default function StockAdjuster({ id, name, stockQty }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState<'add' | 'remove' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<StockAdjustment[] | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)

  function openModal() {
    setQty('')
    setReason('')
    setError(null)
    setHistory(null)
    setOpen(true)
    loadHistory()
  }

  async function loadHistory() {
    setHistoryLoading(true)
    try {
      const res = await fetch(`/admin/api/stock?product_id=${encodeURIComponent(id)}`)
      const data = await res.json()
      setHistory(data.adjustments ?? [])
    } catch {
      setHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }

  async function submit(direction: 'add' | 'remove') {
    const n = parseInt(qty, 10)
    if (!Number.isInteger(n) || n <= 0) {
      setError('Enter a whole number greater than 0.')
      return
    }
    setSaving(direction)
    setError(null)
    try {
      const res = await fetch('/admin/api/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_id: id,
          delta: direction === 'add' ? n : -n,
          reason: reason.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Adjustment failed')
      setQty('')
      setReason('')
      router.refresh()
      loadHistory()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Adjustment failed')
    } finally {
      setSaving(null)
    }
  }

  return (
    <>
      <button
        onClick={openModal}
        className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
      >
        {stockQty.toLocaleString()} in stock
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !saving && setOpen(false)}
        >
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="mb-1 text-lg font-bold text-gray-900">Adjust stock</h2>
            <p className="mb-4 text-xs text-gray-500 truncate">{name}</p>

            <p className="mb-4 text-sm text-gray-700">
              Current: <span className="font-semibold">{stockQty.toLocaleString()}</span>
            </p>

            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Quantity</label>
                <input
                  type="number"
                  min={1}
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                  placeholder="e.g. 10"
                  className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Reason (optional)</label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. received shipment, damaged, recount"
                  className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              </div>
            </div>

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => submit('remove')}
                disabled={!!saving}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {saving === 'remove' ? 'Removing…' : '− Remove'}
              </button>
              <button
                type="button"
                onClick={() => submit('add')}
                disabled={!!saving}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {saving === 'add' ? 'Adding…' : '+ Add'}
              </button>
            </div>

            {/* History */}
            <div className="mt-6 border-t border-gray-100 pt-4">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Recent history
              </h3>
              {historyLoading && <p className="text-xs text-gray-400">Loading…</p>}
              {!historyLoading && history && history.length === 0 && (
                <p className="text-xs text-gray-400">No manual adjustments yet.</p>
              )}
              {!historyLoading && history && history.length > 0 && (
                <ul className="max-h-40 space-y-1.5 overflow-auto text-xs">
                  {history.map((h) => (
                    <li key={h.id} className="flex items-baseline justify-between gap-2 text-gray-600">
                      <span className={h.delta > 0 ? 'text-green-600' : 'text-red-600'}>
                        {h.delta > 0 ? `+${h.delta}` : h.delta}
                      </span>
                      <span className="flex-1 truncate">{h.reason || '—'}</span>
                      <span className="shrink-0 text-gray-400">
                        {h.changed_by_email} · {new Date(h.created_at).toLocaleDateString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="mt-4 text-right">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={!!saving}
                className="text-sm font-medium text-gray-500 hover:text-gray-700 disabled:opacity-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
