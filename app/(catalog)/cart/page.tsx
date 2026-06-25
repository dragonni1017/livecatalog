'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useCart, formatPrice } from '@/lib/cart-context'
import { cdnImage } from '@/lib/image'
import { meetsOrderMinimum, MIN_ORDER_SUBTOTAL_CENTS } from '@/lib/order-rules'
import type { CheckoutContact } from '@/lib/types'

export default function CartPage() {
  const { items, subtotalCents, count, setQty, removeItem, clear, hydrated } = useCart()
  const [contact, setContact] = useState<CheckoutContact>({ name: '', email: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<{ referenceCode: string } | null>(null)

  // Prefill the rep from a per-rep link: a ?rep= visit is stashed in
  // localStorage by RepCapture, so it survives navigation to the cart.
  useEffect(() => {
    try {
      const rep = window.localStorage.getItem('livecatalog_rep')
      // One-time prefill from localStorage on mount — same external-store sync
      // pattern as CartProvider, not a reactive setState loop.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (rep) setContact((c) => ({ ...c, placedByRep: rep }))
    } catch {
      /* localStorage unavailable — rep stays blank */
    }
  }, [])

  const belowMinimum = !meetsOrderMinimum(subtotalCents)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!contact.name.trim() || !contact.email.trim()) {
      setError('Name and email are required.')
      return
    }
    if (items.length === 0) {
      setError('Your cart is empty.')
      return
    }
    if (belowMinimum) {
      setError(`Minimum order is ${formatPrice(MIN_ORDER_SUBTOTAL_CENTS)}. Add more items to submit.`)
      return
    }
    setSubmitting(true)
    try {
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((i) => ({ productId: i.productId, qty: i.qty })),
          contact,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.')
      clear()
      setConfirmed({ referenceCode: data.referenceCode })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Confirmation screen ───────────────────────────────────────────────────
  if (confirmed) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
          <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-gray-900">Request received</h1>
        <p className="mt-2 text-sm text-gray-600">
          A sales rep will follow up with you shortly. Your reference number is:
        </p>
        <p className="mt-3 font-mono text-lg font-bold text-red-600">{confirmed.referenceCode}</p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
        >
          Continue browsing
        </Link>
      </div>
    )
  }

  // ── Empty cart ────────────────────────────────────────────────────────────
  if (hydrated && count === 0) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-xl font-bold text-gray-900">Your cart is empty</h1>
        <p className="mt-2 text-sm text-gray-600">Browse the catalog and add items to request a quote.</p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
        >
          Browse products
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Your Order Request</h1>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Line items */}
        <div className="lg:col-span-2">
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
            {items.map((item) => (
              <li key={item.productId} className="flex items-center gap-4 p-4">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-gray-100">
                  {item.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={cdnImage(item.imageUrl, 150) ?? undefined} alt={item.name} className="h-full w-full object-contain" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-gray-900">{item.name}</p>
                  <p className="font-mono text-xs text-gray-400">{item.sku}</p>
                  <p className="text-sm text-gray-700">{formatPrice(item.priceCents)} each</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    aria-label="Decrease quantity"
                    onClick={() => setQty(item.productId, item.qty - 1)}
                    className="h-7 w-7 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                  >
                    −
                  </button>
                  <span className="w-8 text-center text-sm font-medium">{item.qty}</span>
                  <button
                    type="button"
                    aria-label="Increase quantity"
                    onClick={() => setQty(item.productId, item.qty + 1)}
                    className="h-7 w-7 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                  >
                    +
                  </button>
                </div>
                <div className="w-20 text-right text-sm font-bold text-gray-900">
                  {formatPrice(item.priceCents * item.qty)}
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${item.name}`}
                  onClick={() => removeItem(item.productId)}
                  className="text-gray-400 hover:text-red-600"
                >
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Checkout form + summary */}
        <div className="lg:col-span-1">
          <form onSubmit={handleSubmit} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm text-gray-600">Subtotal</span>
              <span className="text-lg font-bold text-gray-900">{formatPrice(subtotalCents)}</span>
            </div>
            <p className="mb-4 text-xs text-gray-500">
              This is a quote request — no payment is taken. A rep confirms pricing and follows up.
            </p>

            <div className="space-y-3">
              <Field label="Name *" value={contact.name} onChange={(v) => setContact({ ...contact, name: v })} required />
              <Field label="Email *" type="email" value={contact.email} onChange={(v) => setContact({ ...contact, email: v })} required />
              <Field label="Phone" type="tel" value={contact.phone ?? ''} onChange={(v) => setContact({ ...contact, phone: v })} />
              <Field label="Company" value={contact.company ?? ''} onChange={(v) => setContact({ ...contact, company: v })} />
              <Field label="Placed by (rep)" value={contact.placedByRep ?? ''} onChange={(v) => setContact({ ...contact, placedByRep: v })} />
              <Field label="PO number" value={contact.poNumber ?? ''} onChange={(v) => setContact({ ...contact, poNumber: v })} />
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Notes</label>
                <textarea
                  value={contact.notes ?? ''}
                  onChange={(e) => setContact({ ...contact, notes: e.target.value })}
                  rows={3}
                  className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              </div>
            </div>

            {belowMinimum && (
              <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Minimum order is {formatPrice(MIN_ORDER_SUBTOTAL_CENTS)}. Add{' '}
                {formatPrice(MIN_ORDER_SUBTOTAL_CENTS - subtotalCents)} more to submit.
              </p>
            )}

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            <button
              type="submit"
              disabled={submitting || belowMinimum}
              className="mt-4 w-full rounded-md bg-red-600 px-4 py-3 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Submitting…' : 'Submit Order Request'}
            </button>
          </form>
        </div>
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
