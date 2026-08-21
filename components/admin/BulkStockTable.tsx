'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import StockAdjuster from '@/components/admin/StockAdjuster'
import ProductVisibilityToggle from '@/components/admin/ProductVisibilityToggle'
import ProductEditButton from '@/components/admin/ProductEditButton'
import ThresholdCell from './ThresholdCell'
import BulkActionBar from './BulkActionBar'

interface VolumeTier { min_qty: number; price_cents: number }

interface Product {
  id: string
  sku: string | null
  name: string
  description: string | null
  image_url: string | null
  image_urls: string[]
  stock_qty: number
  is_active: boolean
  manually_hidden: boolean
  low_stock_threshold: number | null
  volume_tiers: VolumeTier[] | null
  price_cents: number
  unit_type: 'pc' | 'case' | 'box' | 'pack'
  category: { id: string; name: string } | null
  categoryIds: string[]
}

interface Category {
  id: string
  name: string
}

interface Props {
  products: Product[]
  categories: Category[]
}

export default function BulkStockTable({ products, categories }: Props) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<'adjust' | 'set'>('adjust')
  const [amount, setAmount] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ message: string; ok: boolean } | null>(null)

  const allSelected = products.length > 0 && selected.size === products.length

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(products.map((p) => p.id)))
    }
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  async function applyBulk() {
    const adj = parseInt(amount, 10)
    if (!Number.isInteger(adj)) {
      setResult({ message: 'Enter a valid whole number.', ok: false })
      return
    }
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch('/admin/api/stock/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [...selected], adjustment: adj, mode }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Update failed')
      setResult({ message: `${data.updated} product${data.updated === 1 ? '' : 's'} updated.`, ok: true })
      setSelected(new Set())
      setAmount('')
      router.refresh()
    } catch (err) {
      setResult({ message: err instanceof Error ? err.message : 'Update failed', ok: false })
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="rounded-xl bg-white border border-gray-200 overflow-hidden">
        <div className="overflow-auto max-h-[640px]">
          <table className="w-full text-sm text-left">
            <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                    aria-label="Select all"
                  />
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Image</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">SKU</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Category</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Active</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Stock</th>
                <th
                  className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide"
                  title="Per-product low-stock alert threshold. '—' means the global default (REORDER_THRESHOLD env var) is used."
                >
                  Threshold
                </th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Visibility</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Edit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {products.map((p) => {
                const hasImage = !!p.image_url && p.image_url.trim() !== ''
                const isSelected = selected.has(p.id)
                return (
                  <tr
                    key={p.id}
                    className={isSelected ? 'bg-red-50' : 'hover:bg-gray-50'}
                    onClick={() => toggleOne(p.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleOne(p.id)}
                        className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                        aria-label={`Select ${p.name}`}
                      />
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      {hasImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.image_url as string}
                          alt={p.name}
                          className="h-12 w-12 rounded object-cover bg-gray-100"
                        />
                      ) : (
                        <div className="flex h-12 w-12 items-center justify-center rounded bg-gray-100 text-[10px] text-gray-400">
                          No image
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-800 max-w-[220px] truncate">{p.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">{p.sku || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {p.categoryIds.length > 0
                        ? p.categoryIds
                            .map((id) => categories.find((c) => c.id === id)?.name)
                            .filter(Boolean)
                            .join(', ')
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {p.is_active ? (
                        <span className="text-xs font-medium text-green-600">Active</span>
                      ) : (
                        <span className="text-xs font-medium text-gray-400">Inactive</span>
                      )}
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <StockAdjuster id={p.id} name={p.name} stockQty={p.stock_qty} />
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <ThresholdCell product={p} onSaved={() => router.refresh()} />
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <ProductVisibilityToggle id={p.id} initialHidden={p.manually_hidden} />
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <ProductEditButton
                        id={p.id}
                        name={p.name}
                        description={p.description}
                        imageUrl={p.image_url}
                        imageUrls={p.image_urls}
                        volumeTiers={p.volume_tiers ?? []}
                        priceCents={p.price_cents}
                        unitType={p.unit_type}
                        categoryIds={p.categoryIds}
                        categories={categories}
                      />
                    </td>
                  </tr>
                )
              })}
              {products.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-sm text-gray-400">
                    No products found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Sticky bulk action bar */}
      {selected.size > 0 && (
        <BulkActionBar
          selectedCount={selected.size}
          mode={mode}
          amount={amount}
          loading={loading}
          result={result}
          onModeChange={setMode}
          onAmountChange={(v) => { setAmount(v); setResult(null) }}
          onApply={applyBulk}
          onClearSelection={() => { setSelected(new Set()); setResult(null) }}
        />
      )}
    </>
  )
}
