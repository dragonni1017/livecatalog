'use client'

import { useRef, useState, DragEvent, ChangeEvent } from 'react'
import * as XLSX from 'xlsx'
import type { ExcelRow, ImportResult } from '@/lib/types'

// ────────────────────────────────────────────────────────────
// Types & helpers
// ────────────────────────────────────────────────────────────

type RowStatus = 'valid' | 'warning' | 'error'

interface ValidatedRow {
  index: number
  row: ExcelRow
  status: RowStatus
  issues: string[]
}

type Stage = 'idle' | 'preview' | 'importing' | 'done'

const REQUIRED_COLUMNS = ['SKU', 'Name', 'Category', 'Price'] as const

function validateRows(rows: ExcelRow[]): ValidatedRow[] {
  return rows.map((row, i) => {
    const issues: string[] = []
    let status: RowStatus = 'valid'

    // Required field checks → error
    if (!row.SKU || row.SKU.toString().trim() === '') {
      issues.push('SKU is empty')
      status = 'error'
    }
    if (!row.Name || row.Name.toString().trim() === '') {
      issues.push('Name is empty')
      status = 'error'
    }
    const price = parseFloat(row.Price?.toString() ?? '')
    if (isNaN(price)) {
      issues.push('Price is not a valid number')
      status = 'error'
    }

    // Optional field checks → warning (only if not already an error)
    if (status !== 'error') {
      if (!row.Category || row.Category.toString().trim() === '') {
        issues.push('Category is empty')
        status = 'warning'
      }
      if (!row.Description || row.Description.toString().trim() === '') {
        issues.push('Description missing')
        if (status === 'valid') status = 'warning'
      }
    }

    return { index: i + 2, row, status, issues } // index +2 because row 1 is the header
  })
}

function hasRequiredColumns(rows: ExcelRow[]): { ok: boolean; missing: string[] } {
  if (rows.length === 0) return { ok: false, missing: REQUIRED_COLUMNS.slice() }
  const keys = Object.keys(rows[0])
  const missing = REQUIRED_COLUMNS.filter((col) => !keys.includes(col))
  return { ok: missing.length === 0, missing }
}

// ────────────────────────────────────────────────────────────
// Status badge
// ────────────────────────────────────────────────────────────

function StatusBadge({ status, issues }: { status: RowStatus; issues: string[] }) {
  if (status === 'valid') return <span className="text-green-600 font-medium">✅ Valid</span>
  if (status === 'warning')
    return (
      <span className="text-amber-600 font-medium" title={issues.join('; ')}>
        ⚠️ Warning
      </span>
    )
  return (
    <span className="text-red-600 font-medium" title={issues.join('; ')}>
      ❌ Error
    </span>
  )
}

// ────────────────────────────────────────────────────────────
// Main component
// ────────────────────────────────────────────────────────────

export default function ExcelDropzone() {
  const [stage, setStage] = useState<Stage>('idle')
  const [isDragging, setIsDragging] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [validatedRows, setValidatedRows] = useState<ValidatedRow[]>([])
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Parse helpers ───────────────────────────────────────

  async function processFile(file: File) {
    setParseError(null)

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

      setValidatedRows(validateRows(rows))
      setStage('preview')
    } catch {
      setParseError('Could not parse the file. Make sure it is a valid Excel workbook.')
    }
  }

  // ── Drag handlers ───────────────────────────────────────

  function onDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(true)
  }

  function onDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(false)
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    // Reset input so re-selecting same file fires onChange again
    e.target.value = ''
  }

  // ── Import ───────────────────────────────────────────────

  async function handleImport() {
    const validRows = validatedRows
      .filter((vr) => vr.status !== 'error')
      .map((vr) => vr.row)

    setStage('importing')

    try {
      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: validRows }),
      })
      const result: ImportResult = await res.json()
      setImportResult(result)
      setStage('done')
    } catch {
      setImportResult({
        inserted: 0,
        updated: 0,
        deactivated: 0,
        skipped: 0,
        errors: [{ row: 0, sku: '', message: 'Network error — could not reach the server.' }],
      })
      setStage('done')
    }
  }

  function reset() {
    setStage('idle')
    setValidatedRows([])
    setImportResult(null)
    setParseError(null)
  }

  // ── Derived counts ───────────────────────────────────────

  const validCount = validatedRows.filter((r) => r.status === 'valid').length
  const warningCount = validatedRows.filter((r) => r.status === 'warning').length
  const errorCount = validatedRows.filter((r) => r.status === 'error').length
  const importableCount = validCount + warningCount

  // ────────────────────────────────────────────────────────
  // Render: idle
  // ────────────────────────────────────────────────────────

  if (stage === 'idle') {
    return (
      <div className="space-y-3">
        {parseError && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            {parseError}
          </div>
        )}

        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
          className={`
            relative flex flex-col items-center justify-center w-full rounded-xl border-2 border-dashed
            cursor-pointer transition-colors select-none
            ${isDragging
              ? 'border-red-400 bg-red-50'
              : 'border-gray-300 bg-white hover:border-red-300 hover:bg-gray-50'
            }
          `}
          style={{ minHeight: '200px' }}
        >
          <svg
            className={`w-10 h-10 mb-3 ${isDragging ? 'text-red-400' : 'text-gray-300'}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9 17v-2m3 2v-4m3 4v-6M4 20h16a1 1 0 001-1V7.414a1 1 0 00-.293-.707l-4.414-4.414A1 1 0 0015.586 2H4a1 1 0 00-1 1v16a1 1 0 001 1z"
            />
          </svg>
          <p className={`text-base font-medium ${isDragging ? 'text-red-600' : 'text-gray-600'}`}>
            Drag &amp; drop your Excel file here
          </p>
          <p className="text-sm text-gray-400 mt-1">or click to browse</p>
          <p className="text-xs text-gray-300 mt-2">.xlsx and .xls files only</p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={onFileChange}
        />
      </div>
    )
  }

  // ────────────────────────────────────────────────────────
  // Render: preview
  // ────────────────────────────────────────────────────────

  if (stage === 'preview') {
    return (
      <div className="space-y-4">
        {/* Summary bar */}
        <div className="rounded-lg bg-white border border-gray-200 px-5 py-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-800">
                {validatedRows.length} rows parsed — ready to import
              </p>
              <div className="flex gap-4 mt-1 text-xs">
                <span className="text-green-600 font-medium">{validCount} valid</span>
                {warningCount > 0 && (
                  <span className="text-amber-600 font-medium">{warningCount} warnings</span>
                )}
                {errorCount > 0 && (
                  <span className="text-red-600 font-medium">{errorCount} errors</span>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={reset}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={importableCount === 0}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Confirm Import ({importableCount} rows)
              </button>
            </div>
          </div>

          {errorCount > 0 && (
            <p className="mt-3 text-xs text-red-600 border-t border-gray-100 pt-3">
              {errorCount} row{errorCount !== 1 ? 's' : ''} have errors and will be skipped.
            </p>
          )}
        </div>

        {/* Table */}
        <div className="rounded-xl bg-white border border-gray-200 overflow-hidden">
          <div className="overflow-auto max-h-[480px]">
            <table className="w-full text-sm text-left">
              <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">SKU</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Category</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Price</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Stock Qty</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {validatedRows.map((vr) => (
                  <tr
                    key={vr.index}
                    className={
                      vr.status === 'error'
                        ? 'bg-red-50'
                        : vr.status === 'warning'
                        ? 'bg-amber-50/50'
                        : ''
                    }
                  >
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">
                      {vr.row.SKU?.toString() || '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-800 max-w-[220px] truncate">
                      {vr.row.Name?.toString() || '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {vr.row.Category?.toString() || '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {vr.row.Price != null
                        ? `$${parseFloat(vr.row.Price.toString()).toFixed(2)}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {vr.row['Stock Qty'] != null ? vr.row['Stock Qty'].toString() : '0'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={vr.status} issues={vr.issues} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  // ────────────────────────────────────────────────────────
  // Render: importing
  // ────────────────────────────────────────────────────────

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

  // ────────────────────────────────────────────────────────
  // Render: done
  // ────────────────────────────────────────────────────────

  const result = importResult!
  const hasImportErrors = result.errors.length > 0

  return (
    <div className="space-y-4">
      {/* Success banner */}
      <div
        className={`rounded-lg border px-5 py-4 ${
          hasImportErrors
            ? 'bg-amber-50 border-amber-200'
            : 'bg-green-50 border-green-200'
        }`}
      >
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

      {/* Error list */}
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

      <button
        onClick={reset}
        className="rounded-lg bg-red-600 px-5 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors"
      >
        Import Another File
      </button>
    </div>
  )
}
