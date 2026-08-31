'use client'

import { useState } from 'react'

interface SyncError {
  queueId: string
  orderId: string
  kind: 'error' | 'stuck'
  referenceCode: string
  customerLabel: string
  errorMessage: string | null
  updatedAt: string
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function QbSyncErrors({ initialErrors }: { initialErrors: SyncError[] }) {
  const [errors, setErrors] = useState(initialErrors)
  const [retrying, setRetrying] = useState<string | null>(null)

  if (errors.length === 0) return null

  async function handleRetry(item: SyncError) {
    if (
      item.kind === 'stuck' &&
      !confirm(
        `"${item.referenceCode}" was sent to QuickBooks but we never received confirmation back — it may have actually gone through, only the response was lost (e.g. a dropped connection).\n\nCheck QuickBooks itself for this order/reference number FIRST. If it's already there, do NOT retry — mark it Entered manually instead. Only retry if you've confirmed it does NOT exist in QuickBooks yet, since retrying could create a duplicate Sales Order.\n\nContinue with the retry?`,
      )
    ) {
      return
    }
    setRetrying(item.queueId)
    try {
      const res = await fetch('/admin/api/qbwc/sync-errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueId: item.queueId }),
      })
      const json = await res.json()
      if (!res.ok) {
        alert(json.error ?? 'Failed to retry.')
        return
      }
      setErrors((prev) => prev.filter((e) => e.queueId !== item.queueId))
    } catch {
      alert('Network error. Please try again.')
    } finally {
      setRetrying(null)
    }
  }

  const failed = errors.filter((e) => e.kind === 'error')
  const stuck = errors.filter((e) => e.kind === 'stuck')

  return (
    <>
      {failed.length > 0 && (
        <div className="mt-6 rounded-xl bg-white border border-red-200 shadow-sm overflow-hidden">
          <h2 className="px-5 pt-5 pb-3 text-sm font-semibold uppercase tracking-wide text-red-600">
            Failed syncs ({failed.length})
          </h2>
          <p className="px-5 pb-3 text-xs text-gray-500 -mt-2">
            These orders were converted but QuickBooks rejected them — nothing was created, and they
            will never automatically retry. Fix the underlying issue if needed (e.g. QuickBooks was
            mid-edit, a company-file rejection), then retry.
          </p>
          <SyncErrorList items={failed} retrying={retrying} onRetry={handleRetry} />
        </div>
      )}

      {stuck.length > 0 && (
        <div className="mt-6 rounded-xl bg-white border border-amber-300 shadow-sm overflow-hidden">
          <h2 className="px-5 pt-5 pb-3 text-sm font-semibold uppercase tracking-wide text-amber-700">
            Stuck syncs — possible dropped connection ({stuck.length})
          </h2>
          <p className="px-5 pb-3 text-xs text-gray-500 -mt-2">
            These were sent to QuickBooks but never confirmed back (no error, no success) — likely a
            dropped Web Connector connection mid-sync. Unlike a failed sync, a stuck one might have
            actually succeeded in QuickBooks. <strong>Check QuickBooks for the order first</strong>{' '}
            before retrying — retrying one that already went through creates a duplicate Sales Order.
          </p>
          <SyncErrorList items={stuck} retrying={retrying} onRetry={handleRetry} />
        </div>
      )}
    </>
  )
}

function SyncErrorList({
  items,
  retrying,
  onRetry,
}: {
  items: SyncError[]
  retrying: string | null
  onRetry: (item: SyncError) => void
}) {
  return (
    <div className="divide-y divide-gray-100">
      {items.map((e) => (
        <div key={e.queueId} className="px-5 py-3 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900">
              {e.referenceCode}
              {e.customerLabel ? <span className="text-gray-400 font-normal"> · {e.customerLabel}</span> : null}
            </p>
            {e.kind === 'error' ? (
              <p className="mt-0.5 text-xs text-red-600 break-words">{e.errorMessage ?? 'Unknown error'}</p>
            ) : (
              <p className="mt-0.5 text-xs text-amber-700">Sent, never confirmed</p>
            )}
            <p className="mt-0.5 text-xs text-gray-400">
              {e.kind === 'error' ? 'Failed' : 'Last attempt'} {formatDate(e.updatedAt)}
            </p>
          </div>
          <button
            onClick={() => onRetry(e)}
            disabled={retrying === e.queueId}
            className={`flex-shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 transition-colors ${
              e.kind === 'error'
                ? 'border-red-300 text-red-700 hover:bg-red-50'
                : 'border-amber-400 text-amber-800 hover:bg-amber-50'
            }`}
          >
            {retrying === e.queueId ? 'Retrying…' : e.kind === 'error' ? 'Retry' : 'Force retry'}
          </button>
        </div>
      ))}
    </div>
  )
}
