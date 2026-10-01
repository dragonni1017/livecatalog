'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { readApiError, TRANSPORT_ERROR } from '@/lib/admin-fetch'

// Name fix for one /admin/cleanup row: dry run first, then an explicit
// confirm. Both go to POST /admin/api/cleanup/name (lib/product-name-fix.ts),
// which writes Erply, WooCommerce and the catalog, each only if it still
// holds `currentName`.
//
// The field is prefilled ONLY from auditProductName's suggestion (already
// filtered by lib/cleanup.ts so it can't alter the pack spec). With no
// suggestion it starts empty -- a missing or inconsistent pack spec can't be
// worked out from the name, and the route refuses spec changes anyway.

interface Row {
  system: string
  id: string
  oldName: string
  newName: string
  status: string
  detail?: string
}

interface Props {
  sku: string
  currentName: string
  suggestion: string | null
}

export default function CleanupNameFix({ sku, currentName, suggestion }: Props) {
  const router = useRouter()
  const [to, setTo] = useState(suggestion ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The dry run's rows, for the `to` they were computed for. Editing the
  // field invalidates them, so apply always follows a check of the exact text.
  const [preview, setPreview] = useState<{ to: string; rows: Row[] } | null>(null)
  const [applied, setApplied] = useState<Row[] | null>(null)

  const trimmed = to.trim()
  const previewCurrent = preview && preview.to === trimmed ? preview : null
  const wouldUpdate = previewCurrent?.rows.filter((r) => r.status === 'would update').length ?? 0

  async function call(apply: boolean) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/admin/api/cleanup/name', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sku, expect: currentName, to: trimmed, apply }),
      })
      const err = await readApiError(res, apply ? 'Rename failed.' : 'Check failed.')
      if (err) {
        setError(err)
        return
      }
      const json = (await res.json()) as { rows: Row[] }
      if (apply) {
        setApplied(json.rows)
        setPreview(null)
        router.refresh()
      } else {
        setPreview({ to: trimmed, rows: json.rows })
        setApplied(null)
      }
    } catch {
      setError(TRANSPORT_ERROR)
    } finally {
      setBusy(false)
    }
  }

  const rows = applied ?? previewCurrent?.rows ?? null

  return (
    <div className="flex min-w-[22rem] flex-col gap-2">
      <input
        type="text"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        placeholder={suggestion ? '' : 'No mechanical fix — type the corrected name'}
        className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900"
      />
      {!suggestion && (
        <p className="text-xs text-gray-400">
          No suggestion: the fix isn&apos;t mechanical. Pack-spec changes go through scripts/fix-product-names.ts.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => call(false)}
          disabled={busy || !trimmed || trimmed === currentName}
          className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors"
        >
          {busy && !previewCurrent ? 'Checking…' : 'Check (dry run)'}
        </button>
        {previewCurrent && wouldUpdate > 0 && (
          <button
            type="button"
            onClick={() => call(true)}
            disabled={busy}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-40 transition-colors"
          >
            {busy ? 'Applying…' : `Apply to ${wouldUpdate} system${wouldUpdate === 1 ? '' : 's'}`}
          </button>
        )}
        {previewCurrent && wouldUpdate === 0 && (
          <span className="text-xs text-gray-500">Nothing would be written — see below.</span>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {rows && (
        <table className="text-xs">
          <tbody>
            {rows.map((r) => (
              <tr key={r.system} className="align-top">
                <td className="pr-3 font-medium text-gray-700">{r.system}</td>
                <td
                  className={
                    r.status.startsWith('FAILED')
                      ? 'text-red-600'
                      : r.status.startsWith('SKIPPED')
                        ? 'text-amber-700'
                        : 'text-gray-700'
                  }
                >
                  {r.status}
                  {r.id ? <span className="text-gray-400"> #{r.id}</span> : null}
                  {r.status.startsWith('SKIPPED — name differs') && r.oldName && (
                    <div className="text-gray-500">holds: {r.oldName}</div>
                  )}
                  {r.detail && !r.detail.startsWith('found:') && <div className="text-gray-500">{r.detail}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {applied && (
        <p className="text-xs text-gray-500">
          Done. &ldquo;updated + verified&rdquo; means the name was read back from that system after the write.
        </p>
      )}
    </div>
  )
}
