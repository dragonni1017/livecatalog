'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { readApiError, TRANSPORT_ERROR } from '@/lib/admin-fetch'
import type { OrderStatus } from '@/lib/types'

// Close an old quote without emailing the customer (Orders -> Needs
// follow-up). Contacted / Lost / Converted set the real status via
// PATCH /admin/api/orders { notify: false }; Converted still queues the
// order for QuickBooks and takes the items out of stock, so it asks twice.
// Duplicate (only offered when a later quote exists) uses the silent dismiss.

const QUIET: { status: OrderStatus; label: string }[] = [
  { status: 'contacted', label: 'Contacted' },
  { status: 'lost', label: 'Lost' },
  { status: 'converted', label: 'Converted' },
]

export default function QuietCloseControls({ id, canDuplicate }: { id: string; canDuplicate: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmConvert, setConfirmConvert] = useState(false)

  async function send(url: string, method: string, body: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) })
      const err = await readApiError(res, 'Could not save.')
      if (err) return setError(err)
      router.refresh()
    } catch {
      setError(TRANSPORT_ERROR)
    } finally {
      setBusy(false)
      setConfirmConvert(false)
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Close, no email</div>
      <div className="flex flex-wrap gap-1">
        {QUIET.map((q) => (
          <button
            key={q.status}
            type="button"
            disabled={busy}
            onClick={() => {
              if (q.status === 'converted' && !confirmConvert) return setConfirmConvert(true)
              send('/admin/api/orders', 'PATCH', { status: q.status, notify: false })
            }}
            className={
              'rounded-md px-2 py-0.5 text-xs font-semibold disabled:opacity-50 ' +
              (q.status === 'converted' && confirmConvert
                ? 'bg-green-600 text-white hover:bg-green-700'
                : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50')
            }
          >
            {q.status === 'converted' && confirmConvert ? 'Confirm converted' : q.label}
          </button>
        ))}
        {canDuplicate && (
          <button
            type="button"
            disabled={busy}
            onClick={() => send('/admin/api/orders/dismiss', 'POST', { reason: 'duplicate' })}
            className="rounded-md border border-gray-300 bg-white px-2 py-0.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            Duplicate
          </button>
        )}
      </div>
      {confirmConvert && (
        <div className="max-w-[16rem] text-xs text-amber-700">
          Converted sends it to QuickBooks and takes the items out of stock. Click again to confirm.
        </div>
      )}
      {error && <div className="max-w-[16rem] text-xs text-red-600">{error}</div>}
    </div>
  )
}
