'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { readApiError } from '@/lib/admin-fetch'
import { DISMISS_REASONS, DISMISS_REASON_LABELS, isDismissReason, type DismissReason } from '@/lib/order-dismiss'

interface Props {
  id: string
  dismissedAt: string | null
  dismissedReason: string | null
  /** Why dismissing isn't offered (not new, already in QuickBooks); null = offer it. */
  blocker: string | null
}

// Silent dismiss for test/duplicate/spam requests (lib/order-dismiss.ts).
// No email, no stock change, no QuickBooks: it only hides the order from the
// "waiting" counts, and Undo puts it back.
export default function OrderDismissControls({ id, dismissedAt, dismissedReason, blocker }: Props) {
  const router = useRouter()
  const [reason, setReason] = useState<DismissReason>('test')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(body: Record<string, unknown>) {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/admin/api/orders/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      })
      const err = await readApiError(res, 'Request failed.')
      if (err) {
        setError(err)
        return
      }
      router.refresh()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (dismissedAt) {
    const label = isDismissReason(dismissedReason) ? DISMISS_REASON_LABELS[dismissedReason] : dismissedReason
    return (
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-700">
            Dismissed: {label}
          </span>
          <span className="text-xs text-gray-500">
            {new Date(dismissedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </span>
          <button
            onClick={() => send({ undo: true })}
            disabled={busy}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {busy ? '…' : 'Undo'}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>
    )
  }

  if (blocker) return null

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={reason}
          onChange={(e) => setReason(e.target.value as DismissReason)}
          disabled={busy}
          className="rounded-md border border-gray-300 bg-white py-1.5 pl-2 pr-7 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
        >
          {DISMISS_REASONS.map((r) => (
            <option key={r} value={r}>
              {DISMISS_REASON_LABELS[r]}
            </option>
          ))}
        </select>
        <button
          onClick={() => send({ reason })}
          disabled={busy}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {busy ? '…' : 'Dismiss'}
        </button>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        Takes it out of the waiting counts. The customer is not emailed, and stock and QuickBooks are not touched. You can undo it.
      </p>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  )
}
