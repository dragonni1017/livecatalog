'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'

interface LookupProduct {
  id: string
  sku: string
  name: string
  price_cents: number
  image_url: string | null
  stock_qty: number
}

type CsvRow = {
  sku: string
  qty: number
  status: 'pending' | 'valid' | 'invalid'
  productName?: string
}

interface AddItemFn {
  (item: { productId: string; sku: string; name: string; priceCents: number; imageUrl: string | null }, qty: number): void
}

interface CsvUploadPanelProps {
  addItem: AddItemFn
}

function parseCsv(text: string): { sku: string; qty: number }[] {
  const lines = text.trim().split('\n').map((l) => l.trim()).filter(Boolean)
  const results: { sku: string; qty: number }[] = []
  for (const line of lines) {
    const [skuRaw, qtyRaw] = line.split(',').map((s) => s.trim().replace(/^"|"$/g, ''))
    if (!skuRaw || skuRaw.toLowerCase() === 'sku') continue // skip header
    const qty = parseInt(qtyRaw ?? '1', 10)
    if (!isNaN(qty) && qty > 0) results.push({ sku: skuRaw.toUpperCase(), qty })
  }
  return results
}

export default function CsvUploadPanel({ addItem }: CsvUploadPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [csvRows, setCsvRows] = useState<CsvRow[]>([])
  const [csvChecking, setCsvChecking] = useState(false)
  const [csvBusy, setCsvBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  async function processCsvFile(file: File) {
    const text = await file.text()
    const parsed = parseCsv(text).slice(0, 50) // cap at 50 rows
    if (parsed.length === 0) return

    const rows: CsvRow[] = parsed.map((p) => ({ ...p, status: 'pending' }))
    setCsvRows(rows)
    setCsvChecking(true)

    try {
      const skus = [...new Set(parsed.map((p) => p.sku))]
      const res = await fetch('/api/products/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skus }),
      })
      const data = await res.json()
      const bySku = new Map<string, LookupProduct>((data.products ?? []).map((p: LookupProduct) => [p.sku, p]))

      setCsvRows(
        parsed.map((p) => {
          const match = bySku.get(p.sku)
          return match
            ? { ...p, status: 'valid', productName: match.name }
            : { ...p, status: 'invalid' }
        }),
      )
    } catch {
      setCsvRows(parsed.map((p) => ({ ...p, status: 'invalid' })))
    } finally {
      setCsvChecking(false)
    }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) processCsvFile(file)
    e.target.value = ''
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) processCsvFile(file)
  }

  async function addCsvToCart() {
    const validRows = csvRows.filter((r) => r.status === 'valid')
    if (validRows.length === 0) return
    setCsvBusy(true)
    try {
      const skus = [...new Set(validRows.map((r) => r.sku))]
      const res = await fetch('/api/products/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skus }),
      })
      const data = await res.json()
      const bySku = new Map<string, LookupProduct>((data.products ?? []).map((p: LookupProduct) => [p.sku, p]))
      for (const { sku, qty } of validRows) {
        const p = bySku.get(sku)
        if (!p) continue
        addItem(
          { productId: p.id, sku: p.sku, name: p.name, priceCents: p.price_cents, imageUrl: p.image_url },
          qty,
        )
      }
    } finally {
      setCsvBusy(false)
    }
  }

  const validCount = csvRows.filter((r) => r.status === 'valid').length
  const invalidCount = csvRows.filter((r) => r.status === 'invalid').length

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-gray-700">Upload CSV</h2>

      <div
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => fileInputRef.current?.click()}
        className={`rounded-xl border-2 border-dashed p-6 text-center transition-colors cursor-pointer ${
          dragOver ? 'border-red-400 bg-red-50' : 'border-gray-300 hover:border-red-400'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={handleFile}
        />
        <p className="text-sm text-gray-500">
          Drop a CSV file here or{' '}
          <span className="text-red-600 underline">browse</span>
        </p>
        <p className="text-xs text-gray-400 mt-1">Format: SKU, Qty (one per row, max 50)</p>
      </div>

      {csvChecking && (
        <p className="mt-3 text-sm text-gray-500 animate-pulse">Checking SKUs…</p>
      )}

      {csvRows.length > 0 && !csvChecking && (
        <div className="mt-4">
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">SKU</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Qty</th>
                  <th className="px-3 py-2 text-left font-medium text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {csvRows.map((row, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 font-mono text-gray-900">{row.sku}</td>
                    <td className="px-3 py-2 text-gray-700">{row.qty}</td>
                    <td className="px-3 py-2">
                      {row.status === 'valid' ? (
                        <span className="text-green-700">{row.productName}</span>
                      ) : row.status === 'invalid' ? (
                        <span className="text-red-600">Not found</span>
                      ) : (
                        <span className="text-gray-400">Pending</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={addCsvToCart}
              disabled={csvBusy || validCount === 0}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {csvBusy
                ? 'Adding…'
                : `Add ${validCount} valid item${validCount === 1 ? '' : 's'} to cart`}
            </button>
            {validCount > 0 && !csvBusy && (
              <Link href="/cart" className="text-sm font-medium text-red-600 hover:text-red-700">
                View cart →
              </Link>
            )}
            {invalidCount > 0 && (
              <span className="text-sm text-red-600">
                {invalidCount} SKU{invalidCount === 1 ? '' : 's'} not found
              </span>
            )}
            <button
              type="button"
              onClick={() => setCsvRows([])}
              className="ml-auto text-sm text-gray-400 hover:text-gray-600 underline"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
