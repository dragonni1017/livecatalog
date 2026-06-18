'use client'

import { useRef, useState, DragEvent, ChangeEvent } from 'react'
import * as XLSX from 'xlsx'
import type { ExcelRow, ImportResult, DiffResult, ClassifiedRow } from '@/lib/types'

type Stage = 'idle' | 'diffing' | 'preview' | 'importing' | 'done'

const REQUIRED_COLUMNS = ['SKU', 'Name', 'Category', 'Price'] as const

function hasRequiredColumns(rows: ExcelRow[]): { ok: boolean; missing: string[] } {
  if (rows.length === 0) return { ok: false, missing: REQUIRED_COLUMNS.slice() }
  const keys = Object.keys(rows[0])
  const missing = REQUIRED_COLUMNS.filter((col) => !keys.includes(col))
  return { ok: missing.length === 0, missing }
}

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

export default function ExcelDropzone() {
  const [stage, setStage] = useState<Stage>('idle')
  const [isDragging, setIsDragging] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [showUnchanged, setShowUnchanged] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function processFile(file: File) {
    setParseError(null)
    setDiffError(null)

    if (!file.name.match(/\.(xlsx|xls)$/i)) {
      setParseError('Please upload an .xlsx or .xls file.')
      return
    }

    try {
      const data = await file.arrayBuffer()
      const workbook = XLSX.read(data, { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows: ExcelRow[] = XLSX.utils.sheet_to_json(sheet)

      if (rows.length === 0) {
        setParseError('The file appears to be empty.')
        return
      }

      const { ok, missing } = hasRequiredColumns(rows)
      if (!ok) {
        setParseError(`Missing required columns: ${missing.join(', ')}`)
        return
      }

      setStage('diffing')

      const res = await fetch('/api/import/diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })

      if (!res.ok) throw new Error('Server error computing diff')

      const result: DiffResult = await res.json()
      setDiffResult(result)
      setStage('preview')
    } catch (err) {
      setDiffError(err instanceof Error ? err.message : 'Could not compare against catalog. Please try again.')
      setStage('idle')
    }
  }

  function onDragOver(e: DragEvent<HTMLDivElement>) { e.preventDefault(); setIsDragging(true) }
  function onDragLeave(e: DragEvent<HTMLDivElement>) { e.preventDefault(); setIsDragging(false) }
  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }
  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ''
  }

  async function handleImport() {
    if (!diffResult) return
    const validRows = diffResult.rows.filter((r) => r.validStatus !== 'error').map((r) => r.row)
    setStage('importing')
    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: validRows }),
      })
      setImportResult(await res.json())
      setStage('done')
    } catch {
      setImportResult({
        inserted: 0, updated: 0, deactivated: 0, skipped: 0,
        errors: [{ row: 0, sku: '', message: 'Network error — could not reach the server.' }],
      })
      setStage('done')
    }
  }

  function reset() {
    setStage('idle')
    setDiffResult(null)
    setImportResult(null)
    setParseError(null)
    setDiffError(null)
    setShowUnchanged(false)
  }

  // ── Derived counts ───────────────────────────────────────

  const newCount       = diffResult?.rows.filter((r) => r.status === 'new').length ?? 0
  const changedCount   = diffResult?.rows.filter((r) => r.status === 'changed').length ?? 0
  const unchangedCount = diffResult?.rows.filter((r) => r.status === 'unchanged').length ?? 0
  const errorCount     = diffResult?.rows.filter((r) => r.validStatus === 'error').length ?? 0
  const importableCount = (diffResult?.rows.length ?? 0) - errorCount
  const visibleRows = diffResult?.rows.filter((r) => showUnchanged || r.status !== 'unchanged') ?? []

  // ── Idle ─────────────────────────────────────────────────

  if (stage === 'idle') {
    return (
      <div className="space-y-3">
        {(parseError || diffError) && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {parseError || diffError}
          </div>
        )}
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={`relative flex flex-col items-center justify-center w-full rounded-xl border-2 border-dashed cursor-pointer transition-colors select-none ${
            isDragging ? 'border-red-400 bg-red-50' : 'border-gray-300 bg-white hover:border-red-300 hover:bg-gray-50'
          }`}
          style={{ minHeight: '200px' }}
        >
          <svg className={`w-10 h-10 mb-3 ${isDragging ? 'text-red-400' : 'text-gray-300'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6M4 20h16a1 1 0 001-1V7.414a1 1 0 00-.293-.707l-4.414-4.414A1 1 0 0015.586 2H4a1 1 0 00-1 1v16a1 1 0 001 1z" />
          </svg>
          <p className={`text-base font-medium ${isDragging ? 'text-red-600' : 'text-gray-600'}`}>
            Drag &amp; drop your Excel file here
          </p>
          <p className="text-sm text-gray-400 mt-1">or click to browse</p>
          <p className="text-xs text-gray-300 mt-2">.xlsx and .xls files only</p>
        </div>
        <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onFileChange} />
      </div>
    )
  }

  // ── Diffing (loading) ─────────────────────────────────────

  if (stage === 'diffing') {
    return (
      <div className="rounded-xl bg-white border border-gray-200 px-6 py-12 flex flex-col items-center gap-4">
        <div className="w-full max-w-sm rounded-full overflow-hidden bg-gray-100 h-2">
          <div className="h-2 bg-red-500 rounded-full animate-pulse w-2/3" />
        </div>
        <p className="text-sm text-gray-500 animate-pulse">Comparing against current catalog…</p>
      </div>
    )
  }

  // ── Preview ───────────────────────────────────────────────

  if (stage === 'preview') {
    const diff = diffResult!
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
                  onChange={(e) => setShowUnchanged(e.target.checked)}
                  className="rounded border-gray-300"
                />
                Show unchanged
              </label>
              <button onClick={reset} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button
                onClick={handleImport}
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

  // ── Importing ─────────────────────────────────────────────

  if (stage === 'importing') {
    return (
      <div className="rounded-xl bg-white border border-gray-200 px-6 py-12 flex flex-col items-center gap-5">
        <div className="w-full max-w-sm rounded-full overflow-hidden bg-gray-100 h-2">
          <div className="h-2 bg-red-500 rounded-full animate-pulse w-2/3" />
        </div>
        <p className="text-sm text-gray-500 animate-pulse">Importing products…</p>
      </div>
    )
  }

  // ── Done ─────────────────────────────────────────────────

  const result = importResult!
  const hasImportErrors = result.errors.length > 0

  return (
    <div className="space-y-4">
      <div className={`rounded-lg border px-5 py-4 ${hasImportErrors ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
        <p className={`text-base font-semibold ${hasImportErrors ? 'text-amber-800' : 'text-green-800'}`}>
          ✓ Import complete
        </p>
        <p className="text-sm mt-1 text-gray-600">
          <span className="font-medium text-green-700">{result.inserted} inserted</span>
          {' · '}
          <span className="font-medium text-blue-700">{result.updated} updated</span>
          {' · '}
          <span className="font-medium text-gray-500">{result.deactivated} deactivated</span>
          {' · '}
          <span className="font-medium text-gray-400">{result.skipped} skipped</span>
        </p>
      </div>

      {hasImportErrors && (
        <div className="rounded-xl bg-white border border-red-200 overflow-hidden">
          <div className="px-4 py-3 bg-red-50 border-b border-red-200">
            <p className="text-sm font-semibold text-red-700">
              {result.errors.length} row{result.errors.length !== 1 ? 's' : ''} had errors
            </p>
          </div>
          <div className="overflow-auto max-h-64">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Row</th>
                  <th className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase">SKU</th>
                  <th className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {result.errors.map((err, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 text-gray-500">{err.row || '—'}</td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-700">{err.sku || '—'}</td>
                    <td className="px-4 py-2 text-red-600">{err.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <button onClick={reset} className="rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors">
        Import Another File
      </button>
    </div>
  )
}
