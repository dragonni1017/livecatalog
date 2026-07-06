'use client'

import { useRef, useState, DragEvent, ChangeEvent } from 'react'
import * as XLSX from 'xlsx'
import type { ExcelRow, ImportResult, DiffResult, BarcodeCorrection } from '@/lib/types'
import ImportPreviewPanel from './ImportPreviewPanel'
import ImportResultPanel from './ImportResultPanel'

type Stage = 'idle' | 'diffing' | 'preview' | 'importing' | 'done'

const REQUIRED_COLUMNS = ['SKU', 'Name', 'Category', 'Price'] as const
const BARCODE_COLUMNS = ['Barcode', 'GTIN, UPC, EAN, or ISBN'] as const

function hasRequiredColumns(rows: ExcelRow[]): { ok: boolean; missing: string[] } {
  if (rows.length === 0) return { ok: false, missing: REQUIRED_COLUMNS.slice() }
  const keys = Object.keys(rows[0])
  const missing = REQUIRED_COLUMNS.filter((col) => !keys.includes(col))
  return { ok: missing.length === 0, missing }
}

/**
 * SheetJS reads a Barcode/GTIN cell that *looks* numeric as a JS number
 * (default `raw: true`), so a code like "012345678905" loses its leading
 * zero the moment it's turned back into a string — a different, shorter
 * number than what's printed/scanned anywhere else (Excel, TBarcode,
 * the physical product). That single missing digit is enough for a
 * barcode to decode to the wrong item.
 *
 * Re-parsing with `raw: false` returns each cell's *formatted* text
 * instead of its bare value — the same text Excel itself displays. If the
 * Barcode column has a digit-padding number format (a common pattern for
 * GTIN/UPC/EAN template columns, which is very likely what TBarcode is
 * also reading), that formatted text still has the leading zero(s) even
 * though the underlying number doesn't. We only swap in the formatted
 * version when it's purely digits and strictly longer than the raw
 * value — i.e. it actually recovered a stripped zero — so this can't
 * corrupt a value that was already correct.
 *
 * Only the Barcode-ish columns are touched; Price/Stock Qty etc. keep
 * using the original raw numeric parse so currency/number formatting
 * elsewhere in the sheet doesn't break.
 *
 * Every value that actually gets swapped is also returned as a
 * `BarcodeCorrection` (original + corrected, keyed by SKU) so the caller can
 * log it to the `barcode_corrections` table before import — that's the
 * paper trail for retracing/reverting a correction if one is ever wrong.
 */
function recoverLeadingZeros(
  rows: ExcelRow[],
  sheet: XLSX.WorkSheet,
): { rows: ExcelRow[]; corrections: BarcodeCorrection[] } {
  const formattedRows: ExcelRow[] = XLSX.utils.sheet_to_json(sheet, { raw: false })
  const corrections: BarcodeCorrection[] = []

  const fixedRows = rows.map((row, i) => {
    const formatted = formattedRows[i]
    const fixed = { ...row }
    const sku = (row.SKU ?? '').toString().trim()
    for (const col of BARCODE_COLUMNS) {
      const raw = row[col]
      if (raw == null) continue
      const rawDigits = raw.toString()
      const formattedDigits = formatted?.[col]?.toString().replace(/[^\d]/g, '') ?? ''
      if (/^\d+$/.test(formattedDigits) && formattedDigits.length > rawDigits.length) {
        fixed[col] = formattedDigits
        corrections.push({ sku, column: col, original: rawDigits, corrected: formattedDigits })
      }
    }
    return fixed
  })

  return { rows: fixedRows, corrections }
}

export default function ExcelDropzone() {
  const [stage, setStage] = useState<Stage>('idle')
  const [isDragging, setIsDragging] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [diffResult, setDiffResult] = useState<DiffResult | null>(null)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [showUnchanged, setShowUnchanged] = useState(false)
  const [barcodeCorrections, setBarcodeCorrections] = useState<BarcodeCorrection[]>([])
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
      const recovered = recoverLeadingZeros(XLSX.utils.sheet_to_json(sheet), sheet)
      const rows: ExcelRow[] = recovered.rows
      setBarcodeCorrections(recovered.corrections)

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
      // SKUs that got skipped/excluded as invalid don't get imported, so
      // their corrections (if any) shouldn't be logged either — keeps the
      // audit trail limited to values that actually reached the DB.
      const validSkus = new Set(validRows.map((r) => (r.SKU ?? '').toString().trim()))
      const corrections = barcodeCorrections.filter((c) => validSkus.has(c.sku))

      const res = await fetch('/api/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: validRows, barcodeCorrections: corrections }),
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
    setBarcodeCorrections([])
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
    return (
      <ImportPreviewPanel
        diff={diffResult!}
        newCount={newCount}
        changedCount={changedCount}
        unchangedCount={unchangedCount}
        errorCount={errorCount}
        importableCount={importableCount}
        showUnchanged={showUnchanged}
        visibleRows={visibleRows}
        onToggleUnchanged={setShowUnchanged}
        onCancel={reset}
        onConfirmImport={handleImport}
      />
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

  return <ImportResultPanel result={importResult!} onReset={reset} />
}
