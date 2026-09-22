'use client'

import { useCallback, useEffect, useState } from 'react'
import { readApiError, TRANSPORT_ERROR } from '@/lib/admin-fetch'

interface PullState {
  status: 'idle' | 'requested' | 'in_progress' | 'done' | 'error'
  pulled_count: number
  error_message: string | null
  requested_at: string | null
  completed_at: string | null
}

interface PullInfo {
  pull: PullState | null
  directoryCount: number
  blankSkuCount: number
  blankSkusInQuickBooks: number
  /** Not in QuickBooks at all — the list to go and enter. */
  missingSkus: string[]
  /** More than one QuickBooks item reduces to this SKU; never auto-filled. */
  ambiguousSkus: string[]
  /** In QuickBooks but with no description to use as a name. */
  noDescriptionSkus: string[]
  /** A record exists but quotes a different case pack — likely a different product. */
  packMismatchSkus: string[]
}

const STATUS_LABEL: Record<string, string> = {
  idle: 'Never pulled',
  requested: 'Waiting for QuickBooks Web Connector',
  in_progress: 'Pulling…',
  done: 'Complete',
  error: 'Failed',
}

const STATUS_STYLE: Record<string, string> = {
  idle: 'bg-gray-200 text-gray-700',
  requested: 'bg-yellow-100 text-yellow-800',
  in_progress: 'bg-blue-100 text-blue-800',
  done: 'bg-green-100 text-green-800',
  error: 'bg-red-100 text-red-700',
}

export default function ItemPullPanel({ initial }: { initial: PullInfo }) {
  const [info, setInfo] = useState<PullInfo>(initial)
  const [busy, setBusy] = useState(false)
  const [filling, setFilling] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/admin/api/qbwc/item-pull')
      if (!res.ok) return
      setInfo(await res.json())
    } catch {
      // A failed poll is not worth surfacing — the next one will catch up.
    }
  }, [])

  // Only poll while something is actually moving. A pull spans Web
  // Connector's own schedule (15 min by default), so an idle screen polling
  // forever would be pointless traffic.
  const live = info.pull?.status === 'requested' || info.pull?.status === 'in_progress'
  useEffect(() => {
    if (!live) return
    const t = setInterval(refresh, 10000)
    return () => clearInterval(t)
  }, [live, refresh])

  async function requestPull() {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch('/admin/api/qbwc/item-pull', { method: 'POST' })
      const err = await readApiError(res, 'Could not request the item pull.')
      if (err) {
        setError(err)
        return
      }
      await refresh()
    } catch {
      setError(TRANSPORT_ERROR)
    } finally {
      setBusy(false)
    }
  }

  async function fillNames() {
    setError(null)
    setFlash(null)
    setFilling(true)
    try {
      const res = await fetch('/admin/api/qbwc/item-pull', { method: 'PUT' })
      const err = await readApiError(res, 'Could not fill the names.')
      if (err) {
        setError(err)
        return
      }
      const json = await res.json()
      setFlash(
        json.filled > 0
          ? `Named ${json.filled} SKU${json.filled === 1 ? '' : 's'} across ${json.lines} shipment line${json.lines === 1 ? '' : 's'}. Review them on the receiving screen before creating the products.`
          : 'Nothing to fill — no blank SKU had a usable QuickBooks description.',
      )
      await refresh()
    } catch {
      setError(TRANSPORT_ERROR)
    } finally {
      setFilling(false)
    }
  }

  const status = info.pull?.status ?? 'idle'
  const canFill = info.blankSkusInQuickBooks > 0 && !filling && !live

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">QuickBooks item list</h2>
          <p className="mt-1 text-sm text-gray-500">
            Mirrors every item in QuickBooks Desktop here, so a SKU arriving on a container can be
            named from the record you typed in QuickBooks instead of by hand.
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLE[status]}`}>
          {STATUS_LABEL[status]}
        </span>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-4 text-sm">
        <div className="rounded-lg bg-gray-50 px-4 py-3">
          <p className="text-2xl font-semibold text-gray-900">{info.directoryCount.toLocaleString()}</p>
          <p className="text-gray-500">items mirrored</p>
        </div>
        <div className="rounded-lg bg-gray-50 px-4 py-3">
          <p className="text-2xl font-semibold text-gray-900">{info.blankSkuCount.toLocaleString()}</p>
          <p className="text-gray-500">staged SKUs still unnamed</p>
        </div>
        <div className="rounded-lg bg-gray-50 px-4 py-3">
          <p className="text-2xl font-semibold text-gray-900">
            {info.blankSkusInQuickBooks.toLocaleString()}
          </p>
          <p className="text-gray-500">of those found in QuickBooks</p>
        </div>
      </div>

      {info.blankSkuCount > 0 && (
        <div className="mb-4 space-y-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          {info.blankSkusInQuickBooks === 0 ? (
            <p>
              None of the {info.blankSkuCount} unnamed SKUs are in the mirrored list yet. If you have
              since set them up in QuickBooks, pull again — otherwise they still need entering there.
            </p>
          ) : (
            <p>
              <strong>{info.blankSkusInQuickBooks}</strong> of {info.blankSkuCount} unnamed SKUs can be
              named from QuickBooks.
            </p>
          )}

          {/* Each of the three reasons needs a different action, so they're
              listed apart rather than summed into one "not found" count. */}
          {info.missingSkus.length > 0 && (
            <p>
              <strong>{info.missingSkus.length} not in QuickBooks</strong> — enter these there, then
              pull again:{' '}
              <span className="font-mono text-xs text-blue-900">{info.missingSkus.join(', ')}</span>
            </p>
          )}
          {info.ambiguousSkus.length > 0 && (
            <p>
              <strong>{info.ambiguousSkus.length} match more than one QuickBooks item</strong> and
              won&apos;t be filled automatically — naming them from the wrong record is worse than
              leaving them blank:{' '}
              <span className="font-mono text-xs text-blue-900">{info.ambiguousSkus.join(', ')}</span>
            </p>
          )}
          {info.packMismatchSkus.length > 0 && (
            <p className="rounded-md bg-amber-100 px-3 py-2 text-amber-900">
              <strong>
                {info.packMismatchSkus.length} have a QuickBooks record that quotes a different case
                pack
              </strong>{' '}
              than the container ships, so it&apos;s probably a different product — left blank
              rather than named wrongly. Check these by hand:{' '}
              <span className="font-mono text-xs">{info.packMismatchSkus.join(', ')}</span>
            </p>
          )}
          {info.noDescriptionSkus.length > 0 && (
            <p>
              <strong>{info.noDescriptionSkus.length} exist in QuickBooks but have no description</strong>{' '}
              to use as a name:{' '}
              <span className="font-mono text-xs text-blue-900">{info.noDescriptionSkus.join(', ')}</span>
            </p>
          )}
        </div>
      )}

      {flash && (
        <p className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">{flash}</p>
      )}

      {status === 'error' && info.pull?.error_message && (
        <p className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {info.pull.error_message}
        </p>
      )}

      {error && (
        <p className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">{error}</p>
      )}

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={requestPull}
          disabled={busy}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {busy ? 'Requesting…' : status === 'idle' ? 'Pull item list' : 'Pull again'}
        </button>
        {info.blankSkuCount > 0 && (
          <button
            type="button"
            onClick={fillNames}
            disabled={!canFill}
            title={
              live
                ? 'Wait for the pull to finish first.'
                : info.blankSkusInQuickBooks === 0
                  ? 'No blank SKU has a usable QuickBooks description yet.'
                  : undefined
            }
            className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:border-gray-400 hover:bg-gray-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
          >
            {filling ? 'Filling…' : `Fill ${info.blankSkusInQuickBooks} name${info.blankSkusInQuickBooks === 1 ? '' : 's'}`}
          </button>
        )}
        <p className="text-xs text-gray-500">
          {live
            ? `Pulled ${info.pull?.pulled_count ?? 0} so far. Web Connector runs on its own schedule — this can take a few minutes to start.`
            : info.pull?.completed_at
              ? `Last completed ${new Date(info.pull.completed_at).toLocaleString()}.`
              : 'The pull starts the next time QuickBooks Web Connector polls, up to 15 minutes away by default.'}
        </p>
      </div>
    </div>
  )
}
