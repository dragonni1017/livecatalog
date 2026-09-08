'use client'

import { useState } from 'react'

interface SyncError {
  queueId: string
  orderId: string
  kind: 'error' | 'stuck' | 'needs_review'
  referenceCode: string
  customerLabel: string
  errorMessage: string | null
  matchCandidateName?: string | null
  matchCandidateScore?: number | null
  updatedAt: string
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export default function QbSyncErrors({ initialErrors }: { initialErrors: SyncError[] }) {
  const [errors, setErrors] = useState(initialErrors)
  const [busy, setBusy] = useState<string | null>(null)

  if (errors.length === 0) return null

  async function resolve(item: SyncError, action?: 'use_match' | 'create_new') {
    if (
      item.kind === 'stuck' &&
      !confirm(
        `"${item.referenceCode}" was sent to QuickBooks but we never received confirmation back — it may have actually gone through, only the response was lost (e.g. a dropped connection).\n\nCheck QuickBooks itself for this order/reference number FIRST. If it's already there, do NOT retry — mark it Entered manually instead. Only retry if you've confirmed it does NOT exist in QuickBooks yet, since retrying could create a duplicate Sales Order.\n\nContinue with the retry?`,
      )
    ) {
      return
    }
    if (
      action === 'create_new' &&
      !confirm(
        `Create a brand-new QuickBooks customer for "${item.referenceCode}" instead of using "${item.matchCandidateName}"? Only do this if you've confirmed they're genuinely different companies.`,
      )
    ) {
      return
    }
    setBusy(item.queueId)
    try {
      const res = await fetch('/admin/api/qbwc/sync-errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ queueId: item.queueId, ...(action ? { action } : {}) }),
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
      setBusy(null)
    }
  }

  const failed = errors.filter((e) => e.kind === 'error')
  const stuck = errors.filter((e) => e.kind === 'stuck')
  const needsReview = errors.filter((e) => e.kind === 'needs_review')

  return (
    <>
      {needsReview.length > 0 && (
        <div className="mt-6 rounded-xl bg-white border border-blue-200 shadow-sm overflow-hidden">
          <h2 className="px-5 pt-5 pb-3 text-sm font-semibold uppercase tracking-wide text-blue-700">
            Possible existing customer ({needsReview.length})
          </h2>
          <p className="px-5 pb-3 text-xs text-gray-500 -mt-2">
            The buyer&apos;s name/company is similar but not identical to an existing QuickBooks customer —
            too close to guess automatically. Confirm which one is right, then either link to the match or
            create a new customer.
          </p>
          <div className="divide-y divide-gray-100">
            {needsReview.map((e) => (
              <div key={e.queueId} className="px-5 py-3 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">
                    {e.referenceCode}
                    {e.customerLabel ? <span className="text-gray-400 font-normal"> · {e.customerLabel}</span> : null}
                  </p>
                  <p className="mt-0.5 text-xs text-blue-700">
                    Possible match: <span className="font-semibold">{e.matchCandidateName}</span>
                    {typeof e.matchCandidateScore === 'number' ? ` (${Math.round(e.matchCandidateScore * 100)}% similar)` : ''}
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">Held {formatDate(e.updatedAt)}</p>
                </div>
                <div className="flex flex-shrink-0 flex-col gap-1.5 items-end">
                  <button
                    onClick={() => resolve(e, 'use_match')}
                    disabled={busy === e.queueId}
                    className="rounded-lg border border-blue-300 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50 transition-colors"
                  >
                    {busy === e.queueId ? '…' : `Use "${e.matchCandidateName}"`}
                  </button>
                  <button
                    onClick={() => resolve(e, 'create_new')}
                    disabled={busy === e.queueId}
                    className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                  >
                    Not a match — create new
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
          <SyncErrorList items={failed} busy={busy} onRetry={(item) => resolve(item)} />
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
          <SyncErrorList items={stuck} busy={busy} onRetry={(item) => resolve(item)} />
        </div>
      )}
    </>
  )
}

function SyncErrorList({
  items,
  busy,
  onRetry,
}: {
  items: SyncError[]
  busy: string | null
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
            disabled={busy === e.queueId}
            className={`flex-shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold disabled:opacity-50 transition-colors ${
              e.kind === 'error'
                ? 'border-red-300 text-red-700 hover:bg-red-50'
                : 'border-amber-400 text-amber-800 hover:bg-amber-50'
            }`}
          >
            {busy === e.queueId ? 'Retrying…' : e.kind === 'error' ? 'Retry' : 'Force retry'}
          </button>
        </div>
      ))}
    </div>
  )
}
