'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useCart } from '@/lib/cart-context'
import CsvUploadPanel from './CsvUploadPanel'

interface Parsed {
  sku: string
  qty: number
}

interface LookupProduct {
  id: string
  sku: string
  name: string
  price_cents: number
  image_url: string | null
  stock_qty: number
}

// Each line is "SKU", "SKU 12", or "SKU, 12" — first token is the SKU, an
// optional second token is the quantity (defaults to 1).
function parseLines(text: string): Parsed[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/[\s,]+/).filter(Boolean)
      const qty = parts[1] ? Math.max(1, parseInt(parts[1], 10) || 1) : 1
      return { sku: parts[0], qty }
    })
    .filter((p) => p.sku)
}

export default function QuickOrder() {
  const { addItem } = useCart()

  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ added: number; lines: number; notFound: string[]; outOfStock: string[] } | null>(null)

  async function submit() {
    const parsed = parseLines(text)
    if (parsed.length === 0) return
    setBusy(true)
    setResult(null)
    try {
      const skus = [...new Set(parsed.map((p) => p.sku))]
      const res = await fetch('/api/products/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skus }),
      })
      const data = await res.json()
      const bySku = new Map<string, LookupProduct>((data.products ?? []).map((p: LookupProduct) => [p.sku, p]))

      let added = 0
      const notFound: string[] = []
      const outOfStock: string[] = []
      for (const { sku, qty } of parsed) {
        const p = bySku.get(sku)
        if (!p) {
          notFound.push(sku)
          continue
        }
        // Same threshold as AddToCartButton — never add what the normal
        // per-product flow would block.
        if (p.stock_qty <= 0) {
          outOfStock.push(sku)
          continue
        }
        addItem(
          { productId: p.id, sku: p.sku, name: p.name, priceCents: p.price_cents, imageUrl: p.image_url },
          qty,
        )
        added += qty
      }
      setResult({ added, lines: parsed.length, notFound, outOfStock })
    } catch {
      setResult({ added: 0, lines: parsed.length, notFound: [], outOfStock: [] })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* ── CSV Upload ── */}
      <CsvUploadPanel addItem={addItem} />

      {/* ── Manual SKU entry ── */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <label className="mb-1 block text-sm font-medium text-gray-700">SKUs</label>
        <p className="mb-2 text-xs text-gray-500">
          One per line. Add a quantity after the SKU (e.g. <span className="font-mono">ABC-123 24</span>) — defaults to 1.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder={'ABC-123 24\nDEF-456, 12\nGHI-789'}
          className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
        />

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={busy || text.trim().length === 0}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? 'Adding…' : 'Add all to cart'}
          </button>
          {result && result.added > 0 && (
            <Link href="/cart" className="text-sm font-medium text-red-600 hover:text-red-700">
              View cart →
            </Link>
          )}
        </div>

        {result && (
          <div className="mt-4 space-y-2 text-sm">
            {result.added > 0 ? (
              <p className="rounded-md bg-green-50 px-3 py-2 text-green-700">
                Added {result.added} item{result.added === 1 ? '' : 's'} to your cart.
              </p>
            ) : (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-700">
                Nothing was added — check the SKUs below.
              </p>
            )}
            {result.notFound.length > 0 && (
              <p className="rounded-md bg-red-50 px-3 py-2 text-red-700">
                Not found ({result.notFound.length}):{' '}
                <span className="font-mono">{result.notFound.join(', ')}</span>
              </p>
            )}
            {result.outOfStock.length > 0 && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-amber-700">
                Out of stock, not added ({result.outOfStock.length}):{' '}
                <span className="font-mono">{result.outOfStock.join(', ')}</span>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
