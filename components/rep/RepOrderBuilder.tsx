'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRepCart } from '@/lib/rep-cart-context'
import { applyTierDiscount, formatPriceCents, meetsOrderMinimum, MIN_ORDER_SUBTOTAL_CENTS } from '@/lib/order-rules'

interface Tier {
  code: string
  label: string
  discount_percent: number
}

interface LookupProduct {
  id: string
  sku: string
  name: string
  price_cents: number
  image_url: string | null
  stock_qty: number
}

interface Contact {
  name: string
  email: string
  phone: string
  company: string
  notes: string
  poNumber: string
}

const EMPTY_CONTACT: Contact = { name: '', email: '', phone: '', company: '', notes: '', poNumber: '' }

// Each line is "SKU", "SKU 12", or "SKU, 12" — first token is the SKU, an
// optional second token is the quantity (defaults to 1). Mirrors
// components/catalog/QuickOrder.tsx's parser.
function parseLines(text: string): { sku: string; qty: number }[] {
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

export default function RepOrderBuilder({ tiers }: { tiers: Tier[] }) {
  const { items, subtotalCents, setQty, removeItem, clear, addItem, hydrated } = useRepCart()

  const [tierCode, setTierCode] = useState('')
  const [skuText, setSkuText] = useState('')
  const [adding, setAdding] = useState(false)
  const [addResult, setAddResult] = useState<{ added: number; notFound: string[] } | null>(null)

  const [contact, setContact] = useState<Contact>(EMPTY_CONTACT)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<{ referenceCode: string } | null>(null)

  const selectedTier = tiers.find((t) => t.code === tierCode) ?? null
  // Estimate only — the server re-fetches authoritative product prices
  // (including any per-SKU volume-tier break for the actual qty) and
  // re-validates the tier discount at submit time. This preview applies the
  // tier % straight to the base price so it can be shown before that
  // round-trip.
  const estimatedTotalCents = selectedTier
    ? applyTierDiscount(subtotalCents, selectedTier.discount_percent)
    : subtotalCents

  async function handleAddSkus() {
    const parsed = parseLines(skuText)
    if (parsed.length === 0) return
    setAdding(true)
    setAddResult(null)
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
      for (const { sku, qty } of parsed) {
        const p = bySku.get(sku)
        if (!p) {
          notFound.push(sku)
          continue
        }
        addItem({ productId: p.id, sku: p.sku, name: p.name, priceCents: p.price_cents, imageUrl: p.image_url }, qty)
        added += qty
      }
      setAddResult({ added, notFound })
      if (added > 0) setSkuText('')
    } catch {
      setAddResult({ added: 0, notFound: [] })
    } finally {
      setAdding(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!tierCode) {
      setError('Select a price tier.')
      return
    }
    if (!contact.name.trim() || !contact.email.trim()) {
      setError('Customer name and email are required.')
      return
    }
    if (items.length === 0) {
      setError('Add at least one item.')
      return
    }
    if (!meetsOrderMinimum(estimatedTotalCents)) {
      setError(`Minimum order is ${formatPriceCents(MIN_ORDER_SUBTOTAL_CENTS)}.`)
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/rep/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((i) => ({ productId: i.productId, qty: i.qty })),
          contact: {
            name: contact.name,
            email: contact.email,
            phone: contact.phone || undefined,
            company: contact.company || undefined,
            notes: contact.notes || undefined,
            poNumber: contact.poNumber || undefined,
          },
          tierCode,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.')
      clear()
      setContact(EMPTY_CONTACT)
      setConfirmed({ referenceCode: data.referenceCode })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (confirmed) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-bold text-gray-900">Order submitted</h1>
        <p className="mt-2 text-sm text-gray-600">Reference number:</p>
        <p className="mt-3 font-mono text-lg font-bold text-red-600">{confirmed.referenceCode}</p>
        <button
          type="button"
          onClick={() => setConfirmed(null)}
          className="mt-6 inline-block rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
        >
          Start another order
        </button>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
      {/* Left: tier + item entry + line items */}
      <div className="space-y-5 lg:col-span-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <label className="mb-1 block text-sm font-medium text-gray-700">Price tier *</label>
          <select
            value={tierCode}
            onChange={(e) => setTierCode(e.target.value)}
            className="block w-full max-w-xs rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
          >
            <option value="" disabled>Select a tier…</option>
            {tiers.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}{t.discount_percent > 0 ? ` (${t.discount_percent}% off)` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <label className="mb-1 block text-sm font-medium text-gray-700">Add items by SKU</label>
          <p className="mb-2 text-xs text-gray-500">
            One per line. Add a quantity after the SKU (e.g. <span className="font-mono">ABC-123 24</span>) — defaults to 1.
          </p>
          <textarea
            value={skuText}
            onChange={(e) => setSkuText(e.target.value)}
            rows={6}
            placeholder={'ABC-123 24\nDEF-456, 12\nGHI-789'}
            className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 font-mono text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={handleAddSkus}
              disabled={adding || skuText.trim().length === 0}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {adding ? 'Adding…' : 'Add all'}
            </button>
          </div>
          {addResult && addResult.notFound.length > 0 && (
            <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              Not found: <span className="font-mono">{addResult.notFound.join(', ')}</span>
            </p>
          )}
        </div>

        <div className="rounded-xl border border-gray-200 bg-white">
          {items.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-gray-500">
              {hydrated ? 'No items yet — add SKUs above.' : 'Loading…'}
            </p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {items.map((item) => {
                const tierUnit = selectedTier
                  ? applyTierDiscount(item.priceCents, selectedTier.discount_percent)
                  : item.priceCents
                return (
                  <li key={item.productId} className="flex items-center gap-4 p-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">{item.name}</p>
                      <p className="font-mono text-xs text-gray-400">{item.sku}</p>
                      <p className="text-sm text-gray-700">
                        {formatPriceCents(tierUnit)} each
                        {selectedTier && selectedTier.discount_percent > 0 && (
                          <span className="ml-1.5 text-xs text-gray-400 line-through">
                            {formatPriceCents(item.priceCents)}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setQty(item.productId, item.qty - 1)} className="h-7 w-7 rounded border border-gray-300 text-gray-600 hover:bg-gray-50">−</button>
                      <span className="w-8 text-center text-sm font-medium">{item.qty}</span>
                      <button type="button" onClick={() => setQty(item.productId, item.qty + 1)} className="h-7 w-7 rounded border border-gray-300 text-gray-600 hover:bg-gray-50">+</button>
                    </div>
                    <div className="w-20 text-right text-sm font-bold text-gray-900">
                      {formatPriceCents(tierUnit * item.qty)}
                    </div>
                    <button type="button" onClick={() => removeItem(item.productId)} className="text-gray-400 hover:text-red-600" aria-label={`Remove ${item.name}`}>
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Right: customer form + summary */}
      <div className="lg:col-span-1">
        <form onSubmit={handleSubmit} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 space-y-1.5">
            <div className="flex items-center justify-between text-sm text-gray-500">
              <span>List subtotal</span>
              <span>{formatPriceCents(subtotalCents)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Estimated total{selectedTier ? ` (${selectedTier.label})` : ''}</span>
              <span className="text-lg font-bold text-gray-900">{formatPriceCents(estimatedTotalCents)}</span>
            </div>
            <p className="text-xs text-gray-400">Final total is confirmed by the server at submit.</p>
          </div>

          <div className="space-y-3">
            <Field label="Customer name *" value={contact.name} onChange={(v) => setContact({ ...contact, name: v })} required />
            <Field label="Customer email *" type="email" value={contact.email} onChange={(v) => setContact({ ...contact, email: v })} required />
            <Field label="Phone" type="tel" value={contact.phone} onChange={(v) => setContact({ ...contact, phone: v })} />
            <Field label="Company" value={contact.company} onChange={(v) => setContact({ ...contact, company: v })} />
            <Field label="PO number" value={contact.poNumber} onChange={(v) => setContact({ ...contact, poNumber: v })} />
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Notes</label>
              <textarea
                value={contact.notes}
                onChange={(e) => setContact({ ...contact, notes: e.target.value })}
                rows={3}
                className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
              />
            </div>
          </div>

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="mt-4 w-full rounded-md bg-red-600 px-4 py-3 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Submitting…' : 'Submit Order'}
          </button>

          <Link href="/rep" className="mt-3 block text-center text-xs text-gray-400 hover:text-gray-600">
            Back to rep portal
          </Link>
        </form>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  required?: boolean
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-600">{label}</label>
      <input
        type={type}
        value={value}
        required={required}
        onChange={(e) => onChange(e.target.value)}
        className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
      />
    </div>
  )
}
