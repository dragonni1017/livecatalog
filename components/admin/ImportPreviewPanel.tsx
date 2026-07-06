'use client'

import type { DiffResult, ClassifiedRow } from '@/lib/types'

const DIFF_STYLES: Record<ClassifiedRow['status'], { row: string; badge: string; label: string }> = {
  new:       { row: 'bg-green-50',    badge: 'text-green-700 bg-green-100',  label: 'New' },
  changed:   { row: 'bg-amber-50/60', badge: 'text-amber-700 bg-amber-100',  label: 'Changed' },
  unchanged: { row: '',               badge: 'text-gray-400 bg-gray-100',    label: 'Unchanged' },
}

function DiffBadge({ status }: { status: ClassifiedRow['status'] }) {
  const s = DIFF_STYLES[status]
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${s.badge}`}>{s.label}</span>
}

function ValidationNote({ status, issues }: { status: ClassifiedRow['validStatus']; issues: string[] }) {
  if (status === 'valid') return <span className="text-gray-300 text-xs">—</span>
  const color = status === 'error' ? 'text-red-500' : 'text-amber-500'
  return (
    <span className={`text-xs ${color}`} title={issues.join('; ')}>
      {status === 'error' ? '✗' : '⚠'} {issues[0]}
    </span>
  )
}

interface ImportPreviewPanelProps {
  diff: DiffResult
  newCount: number
  changedCount: number
  unchangedCount: number
  errorCount: number
  importableCount: number
  showUnchanged: boolean
  visibleRows: DiffResult['rows']
  onToggleUnchanged: (checked: boolean) => void
  onCancel: () => void
  onConfirmImport: () => void
}

export default function ImportPreviewPanel({
  diff,
  newCount,
  changedCount,
  unchangedCount,
  errorCount,
  importableCount,
  showUnchanged,
  visibleRows,
  onToggleUnchanged,
  onCancel,
  onConfirmImport,
}: ImportPreviewPanelProps) {
  return (
    <div className="space-y-4">
      {/* Summary + actions */}
      <div className="rounded-lg bg-white border border-gray-200 px-5 py-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <p className="text-sm font-semibold text-gray-800">
              {diff.rows.length.toLocaleString()} rows parsed
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
              <span className="text-green-600 font-medium">🟢 {newCount} new</span>
              <span className="text-amber-600 font-medium">🟡 {changedCount} changed</span>
              <span className="text-gray-400 font-medium">⚪ {unchangedCount} unchanged</span>
              {diff.deactivateCount > 0 && (
                <span className="text-red-600 font-medium">🔴 {diff.deactivateCount} will deactivate</span>
              )}
              {errorCount > 0 && (
                <span className="text-red-500 font-medium">✗ {errorCount} errors (will skip)</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showUnchanged}
                onChange={(e) => onToggleUnchanged(e.target.checked)}
                className="rounded border-gray-300"
              />
              Show unchanged
            </label>
            <button onClick={onCancel} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button
              onClick={onConfirmImport}
              disabled={importableCount === 0}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Confirm Import ({importableCount.toLocaleString()} rows)
            </button>
          </div>
        </div>
      </div>

      {/* Deactivation warning */}
      {diff.deactivateCount > 0 && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
          <p className="text-sm font-semibold text-red-700">
            🔴 {diff.deactivateCount} product{diff.deactivateCount !== 1 ? 's' : ''} will be deactivated (not in this file)
          </p>
          {diff.deactivateSample.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-red-600 font-mono">
              {diff.deactivateSample.map((p) => (
                <li key={p.sku}>{p.sku} — {p.name}</li>
              ))}
              {diff.deactivateCount > diff.deactivateSample.length && (
                <li className="text-red-400 font-sans">…and {diff.deactivateCount - diff.deactivateSample.length} more</li>
              )}
            </ul>
          )}
        </div>
      )}

      {/* Rows table */}
      <div className="rounded-xl bg-white border border-gray-200 overflow-hidden">
        <div className="overflow-auto max-h-[480px]">
          <table className="w-full text-sm text-left">
            <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">SKU</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Category</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Price</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Stock</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Diff</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Issues</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {visibleRows.map((vr) => (
                <tr key={vr.rowIndex} className={DIFF_STYLES[vr.status].row}>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">{vr.row.SKU?.toString() || '—'}</td>
                  <td className="px-4 py-3 text-gray-800 max-w-[220px] truncate">{vr.row.Name?.toString() || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">{vr.row.Category?.toString() || '—'}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {vr.row.Price != null ? `$${parseFloat(vr.row.Price.toString()).toFixed(2)}` : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {vr.row['Stock Qty'] != null ? vr.row['Stock Qty'].toString() : '0'}
                  </td>
                  <td className="px-4 py-3"><DiffBadge status={vr.status} /></td>
                  <td className="px-4 py-3"><ValidationNote status={vr.validStatus} issues={vr.issues} /></td>
                </tr>
              ))}
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">
                    All rows are unchanged — toggle &ldquo;Show unchanged&rdquo; to see them.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
