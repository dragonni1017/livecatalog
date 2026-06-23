'use client'

import { useState } from 'react'

interface Preview {
  incoming: number
  wouldInsert: number
  wouldUpdate: number
  wouldDeactivate: number
  deactivateSample: { sku: string; name: string }[]
  newCategories: string[]
}

interface RunResult {
  inserted: number
  updated: number
  deactivated: number
  skipped: number
}

export default function SyncControls({ configured }: { configured: boolean }) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewConfigured, setPreviewConfigured] = useState(true)
  const [result, setResult] = useState<RunResult | null>(null)
  const [busy, setBusy] = useState<'preview' | 'run' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function doPreview() {
    setBusy('preview'); setError(null); setResult(null)
    try {
      const res = await fetch('/admin/api/sync')
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Preview failed')
      setPreview(data.preview)
      setPreviewConfigured(Boolean(data.configured))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed')
    } finally {
      setBusy(null)
    }
  }

  async function doRun() {
    const msg = preview
      ? `Run the sync now? This will insert ${preview.wouldInsert}, update ${preview.wouldUpdate}, and DEACTIVATE ${preview.wouldDeactivate} products.`
      : 'Run the Erply sync now? This will modify the live catalog.'
    if (!window.confirm(msg)) return
    setBusy('run'); setError(null)
    try {
      const res = await fetch('/admin/api/sync', { method: 'POST' })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || data.reason || 'Sync failed')
      setResult(data)
      setPreview(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      {!configured && (
        <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          Erply isn’t configured yet. Set <code className="font-mono">ERPLY_CLIENT_CODE</code>,{' '}
          <code className="font-mono">ERPLY_USERNAME</code>, and <code className="font-mono">ERPLY_PASSWORD</code> in Vercel.
          Until then, a preview reflects demo data (not your real Erply catalog) and running a sync is disabled.
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <button
          onClick={doPreview}
          disabled={busy !== null}
          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {busy === 'preview' ? 'Previewing…' : 'Preview changes'}
        </button>
        <button
          onClick={doRun}
          disabled={busy !== null || !configured}
          title={!configured ? 'Configure Erply first' : undefined}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === 'run' ? 'Syncing…' : 'Run sync now'}
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {/* Preview result */}
      {preview && (
        <div className="mt-5 rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="mb-1 text-sm font-semibold text-gray-900">Dry-run preview</h3>
          {!previewConfigured && (
            <p className="mb-3 text-xs font-medium text-amber-700">
              ⚠️ Demo data — not your real Erply catalog. These numbers are not meaningful until Erply is configured.
            </p>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Incoming" value={preview.incoming} />
            <Stat label="New" value={preview.wouldInsert} tone="green" />
            <Stat label="Updated" value={preview.wouldUpdate} tone="amber" />
            <Stat label="Deactivated" value={preview.wouldDeactivate} tone={preview.wouldDeactivate > 0 ? 'red' : 'gray'} />
          </div>

          {preview.wouldDeactivate > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-red-600">
                Would deactivate {preview.wouldDeactivate} product{preview.wouldDeactivate === 1 ? '' : 's'} (not in the Erply batch)
              </p>
              <p className="mt-1 text-xs text-gray-500">
                If this number is unexpectedly large, the Erply SKUs don’t match your catalog — do NOT run the sync.
              </p>
              <ul className="mt-2 max-h-40 overflow-auto text-xs text-gray-600">
                {preview.deactivateSample.map((p) => (
                  <li key={p.sku} className="font-mono">{p.sku} — {p.name}</li>
                ))}
                {preview.wouldDeactivate > preview.deactivateSample.length && (
                  <li className="text-gray-400">…and {preview.wouldDeactivate - preview.deactivateSample.length} more</li>
                )}
              </ul>
            </div>
          )}

          {preview.newCategories.length > 0 && (
            <p className="mt-4 text-xs text-gray-600">
              <span className="font-semibold">New categories:</span> {preview.newCategories.join(', ')}
            </p>
          )}
        </div>
      )}

      {/* Run result */}
      {result && (
        <div className="mt-5 rounded-xl border border-green-200 bg-green-50 p-5 text-sm text-green-800">
          <p className="font-semibold">Sync complete</p>
          <p className="mt-1">
            {result.inserted} new · {result.updated} updated · {result.deactivated} deactivated · {result.skipped} skipped
          </p>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, tone = 'gray' }: { label: string; value: number; tone?: 'green' | 'amber' | 'red' | 'gray' }) {
  const color = {
    green: 'text-green-700',
    amber: 'text-amber-700',
    red: 'text-red-700',
    gray: 'text-gray-900',
  }[tone]
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value.toLocaleString()}</p>
    </div>
  )
}
