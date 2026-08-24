'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface VolumeTier { min_qty: number; price_cents: number }
interface Category { id: string; name: string }
type UnitType = 'pc' | 'case' | 'box' | 'pack'

const UNIT_TYPE_LABELS: Record<UnitType, string> = {
  pc: 'Per piece',
  case: 'Per case',
  box: 'Per box',
  pack: 'Per pack',
}

const EMPTY_FORM = {
  sku: '',
  name: '',
  barcode: '',
  description: '',
  image_url: '',
  image_urls_text: '',
  price: '0.00',
  stock_qty: '0',
  low_stock_threshold: '',
  unit_type: 'pc' as UnitType,
}

interface Props {
  categories: Category[]
}

// Adds a single new product manually -- same field set as ProductEditButton
// (which edits an existing one) so a manually-added product supports
// everything an imported/synced product does, including photos.
export default function ProductCreateButton({ categories }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([])
  const [tiers, setTiers] = useState<VolumeTier[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function openModal() {
    setForm(EMPTY_FORM)
    setSelectedCategoryIds([])
    setTiers([])
    setError(null)
    setOpen(true)
  }

  function toggleCategory(catId: string) {
    setSelectedCategoryIds((prev) =>
      prev.includes(catId) ? prev.filter((c) => c !== catId) : [...prev, catId],
    )
  }

  function addTier() {
    setTiers((prev) => [...prev, { min_qty: 12, price_cents: 0 }])
  }

  function removeTier(i: number) {
    setTiers((prev) => prev.filter((_, idx) => idx !== i))
  }

  function updateTier(i: number, field: keyof VolumeTier, raw: string) {
    const val = field === 'price_cents' ? Math.round(parseFloat(raw) * 100) : parseInt(raw, 10)
    setTiers((prev) => prev.map((t, idx) => idx === i ? { ...t, [field]: isNaN(val) ? 0 : val } : t))
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!form.sku.trim()) {
      setError('SKU is required.')
      return
    }
    if (!form.name.trim()) {
      setError('Name is required.')
      return
    }
    const priceCents = Math.round(parseFloat(form.price) * 100)
    if (!Number.isInteger(priceCents) || priceCents < 0) {
      setError('Enter a valid, non-negative price.')
      return
    }
    const stockQty = parseInt(form.stock_qty, 10)
    if (!Number.isInteger(stockQty) || stockQty < 0) {
      setError('Enter a valid, non-negative stock quantity.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const additionalUrls = form.image_urls_text
        .split('\n')
        .map((u) => u.trim())
        .filter((u) => u !== '')

      const res = await fetch('/admin/api/products/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sku: form.sku,
          name: form.name,
          barcode: form.barcode,
          description: form.description,
          image_url: form.image_url,
          image_urls: additionalUrls,
          volume_tiers: tiers.length > 0 ? tiers : null,
          price_cents: priceCents,
          stock_qty: stockQty,
          low_stock_threshold: form.low_stock_threshold.trim() ? parseInt(form.low_stock_threshold, 10) : null,
          unit_type: form.unit_type,
          category_ids: selectedCategoryIds,
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Save failed')
      setOpen(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <button
        onClick={openModal}
        className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
      >
        + Add Product
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !saving && setOpen(false)}
        >
          <form
            onClick={(e) => e.stopPropagation()}
            onSubmit={save}
            className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6 shadow-xl"
          >
            <h2 className="mb-1 text-lg font-bold text-gray-900">Add product</h2>
            <p className="mb-4 text-xs text-gray-500">
              New product is active and visible immediately. A later Excel/Erply import matching this SKU will overwrite these fields.
            </p>

            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium text-gray-600">SKU</label>
                  <input
                    value={form.sku}
                    onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium text-gray-600">Barcode <span className="font-normal text-gray-400">(optional)</span></label>
                  <input
                    value={form.barcode}
                    onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                    className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Categories <span className="font-normal text-gray-400">(a product can belong to more than one)</span>
                </label>
                <div className="max-h-40 overflow-y-auto rounded-md border border-gray-300 bg-white p-2">
                  {categories.length === 0 ? (
                    <p className="text-xs text-gray-400">No categories exist yet.</p>
                  ) : (
                    categories.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 py-0.5 text-sm text-gray-800">
                        <input
                          type="checkbox"
                          checked={selectedCategoryIds.includes(c.id)}
                          onChange={() => toggleCategory(c.id)}
                          className="h-3.5 w-3.5 rounded border-gray-300 text-red-600 focus:ring-red-500"
                        />
                        {c.name}
                      </label>
                    ))
                  )}
                </div>
                {selectedCategoryIds.length === 0 && (
                  <p className="mt-1 text-xs text-gray-400">Uncategorized — won&apos;t appear under any category browse.</p>
                )}
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium text-gray-600">Price ($)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={form.price}
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                    className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium text-gray-600">Priced per</label>
                  <select
                    value={form.unit_type}
                    onChange={(e) => setForm({ ...form, unit_type: e.target.value as UnitType })}
                    className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                  >
                    {Object.entries(UNIT_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium text-gray-600">Stock quantity</label>
                  <input
                    type="number"
                    min={0}
                    value={form.stock_qty}
                    onChange={(e) => setForm({ ...form, stock_qty: e.target.value })}
                    className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs font-medium text-gray-600">Low stock threshold <span className="font-normal text-gray-400">(optional)</span></label>
                  <input
                    type="number"
                    min={0}
                    value={form.low_stock_threshold}
                    onChange={(e) => setForm({ ...form, low_stock_threshold: e.target.value })}
                    className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={4}
                  className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              </div>

              {/* Photos */}
              <div className="border-t border-gray-100 pt-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Photos</p>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">Primary image URL</label>
                  <input
                    value={form.image_url}
                    onChange={(e) => setForm({ ...form, image_url: e.target.value })}
                    placeholder="https://…"
                    className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                  />
                  {form.image_url.trim() && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={form.image_url}
                      alt="preview"
                      className="mt-2 h-20 w-20 rounded object-contain bg-gray-100"
                    />
                  )}
                </div>
                <div className="mt-3">
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    Additional images <span className="font-normal text-gray-400">(one URL per line)</span>
                  </label>
                  <textarea
                    value={form.image_urls_text}
                    onChange={(e) => setForm({ ...form, image_urls_text: e.target.value })}
                    rows={3}
                    placeholder={'https://example.com/img1.jpg\nhttps://example.com/img2.jpg'}
                    className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 font-mono"
                  />
                  {/* Thumbnail previews of current additional URLs */}
                  {(() => {
                    const urls = form.image_urls_text
                      .split('\n')
                      .map((u) => u.trim())
                      .filter((u) => u !== '')
                    if (urls.length === 0) return null
                    return (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {urls.map((url, i) => (
                          <div key={i} className="relative group">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url}
                              alt={`Additional image ${i + 1}`}
                              className="h-14 w-14 rounded object-contain bg-gray-100 border border-gray-200"
                            />
                            <button
                              type="button"
                              title="Remove this URL"
                              onClick={() => {
                                const lines = form.image_urls_text
                                  .split('\n')
                                  .map((u) => u.trim())
                                  .filter((u) => u !== '')
                                lines.splice(i, 1)
                                setForm({ ...form, image_urls_text: lines.join('\n') })
                              }}
                              className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-600 text-white text-[10px] leading-none opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                </div>
              </div>
            </div>

            {/* Volume tiers */}
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs font-medium text-gray-600">Volume pricing tiers</label>
                <button
                  type="button"
                  onClick={addTier}
                  className="text-xs text-red-600 hover:text-red-700 font-medium"
                >
                  + Add tier
                </button>
              </div>
              {tiers.length === 0 ? (
                <p className="text-xs text-gray-400">No tiers — standard price applies.</p>
              ) : (
                <div className="space-y-1.5">
                  {tiers.map((t, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-500">Qty ≥</span>
                        <input
                          type="number"
                          min={1}
                          value={t.min_qty}
                          onChange={(e) => updateTier(i, 'min_qty', e.target.value)}
                          className="w-16 rounded border border-gray-300 px-2 py-1 text-xs text-gray-900 focus:border-red-500 focus:outline-none"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="text-xs text-gray-500">Price $</span>
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={(t.price_cents / 100).toFixed(2)}
                          onChange={(e) => updateTier(i, 'price_cents', e.target.value)}
                          className="w-20 rounded border border-gray-300 px-2 py-1 text-xs text-gray-900 focus:border-red-500 focus:outline-none"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeTier(i)}
                        className="text-gray-400 hover:text-red-600 text-xs"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={saving}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {saving ? 'Adding…' : 'Add product'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  )
}
