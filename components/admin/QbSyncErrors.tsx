'use client'

import { useState } from 'react'

interface SyncError {
  queueId: string
  orderId: string
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

  async function handleRetry(queueId: string) {
    setRetrying(queueId)
    try {
      const res = await fetch('/admin/api/qbwc/sync-errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueId }),
      })
      const json = await res.json()
      if (!res.ok) {
        alert(json.error ?? 'Failed to retry.')
        return
      }
      setErrors((prev) => prev.filter((e) => e.queueId !== queueId))
    } catch {
      alert('Network error. Please try again.')
    } finally {
      setRetrying(null)
    }
  }

  return (
    <div className="mt-6 rounded-xl bg-white border border-red-200 shadow-sm overflow-hidden">
      <h2 className="px-5 pt-5 pb-3 text-sm font-semibold uppercase tracking-wide text-red-600">
        Failed syncs ({errors.length})
      </h2>
      <p className="px-5 pb-3 text-xs text-gray-500 -mt-2">
        These orders were converted but QuickBooks rejected them — they will never
        automatically retry. Fix the underlying issue if needed (e.g. QuickBooks was mid-edit,
        a company-file rejection), then retry.
      </p>
      <div className="divide-y divide-gray-100">
        {errors.map((e) => (
          <div key={e.queueId} className="px-5 py-3 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">
                {e.referenceCode}
                {e.customerLabel ? <span className="text-gray-400 font-normal"> · {e.customerLabel}</span> : null}
              </p>
              <p className="mt-0.5 text-xs text-red-600 break-words">{e.errorMessage ?? 'Unknown error'}</p>
              <p className="mt-0.5 text-xs text-gray-400">Failed {formatDate(e.updatedAt)}</p>
            </div>
            <button
              onClick={() => handleRetry(e.queueId)}
              disabled={retrying === e.queueId}
              className="flex-shrink-0 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              {retrying === e.queueId ? 'Retrying…' : 'Retry'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
