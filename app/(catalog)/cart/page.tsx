'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useCart, formatPrice } from '@/lib/cart-context'
import { resolveCdnImage } from '@/lib/image'
import { meetsOrderMinimum, MIN_ORDER_SUBTOTAL_CENTS } from '@/lib/order-rules'
import type { CartItem, CheckoutContact } from '@/lib/types'

interface SavedContact {
  name: string
  email: string
  phone: string
  company: string
  po_number: string
}

const LS_CONTACT_KEY = 'lyu_contact'
const LS_DRAFTS_KEY = 'lyu_drafts'

export default function CartPage() {
  const { items, subtotalCents, count, setQty, removeItem, clear, addItem, hydrated } = useCart()
  const [contact, setContact] = useState<CheckoutContact>({ name: '', email: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<{ referenceCode: string } | null>(null)
  const [preFilled, setPreFilled] = useState(false)
  const [draftNames, setDraftNames] = useState<string[]>([])
  const [draftSaved, setDraftSaved] = useState(false)
  const [requiredShipDate, setRequiredShipDate] = useState('')

  // Load draft names from localStorage on mount. One-time hydration from an
  // external store (can't read on the server), not a reactive setState loop.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LS_DRAFTS_KEY)
      const drafts: Record<string, CartItem[]> = raw ? JSON.parse(raw) : {}
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraftNames(Object.keys(drafts))
    } catch {
      /* localStorage unavailable */
    }
  }, [])

  function handleSaveDraft() {
    if (items.length === 0) return
    const name = window.prompt('Name this draft:', 'Draft ' + new Date().toLocaleDateString())
    if (!name) return
    try {
      const raw = window.localStorage.getItem(LS_DRAFTS_KEY)
      const drafts: Record<string, CartItem[]> = raw ? JSON.parse(raw) : {}
      drafts[name] = items
      window.localStorage.setItem(LS_DRAFTS_KEY, JSON.stringify(drafts))
      setDraftNames(Object.keys(drafts))
      setDraftSaved(true)
      setTimeout(() => setDraftSaved(false), 2000)
    } catch {
      /* localStorage unavailable */
    }
  }

  function handleLoadDraft(e: React.ChangeEvent<HTMLSelectElement>) {
    const name = e.target.value
    if (!name) return
    try {
      const raw = window.localStorage.getItem(LS_DRAFTS_KEY)
      const drafts: Record<string, CartItem[]> = raw ? JSON.parse(raw) : {}
      const draftItems = drafts[name]
      if (!draftItems) return
      clear()
      for (const item of draftItems) {
        const { qty, ...rest } = item
        addItem(rest, qty)
      }
    } catch {
      /* localStorage unavailable */
    }
    // Reset select back to placeholder
    e.target.value = ''
  }

  function handleDeleteDraft(name: string) {
    try {
      const raw = window.localStorage.getItem(LS_DRAFTS_KEY)
      const drafts: Record<string, CartItem[]> = raw ? JSON.parse(raw) : {}
      delete drafts[name]
      window.localStorage.setItem(LS_DRAFTS_KEY, JSON.stringify(drafts))
      setDraftNames(Object.keys(drafts))
    } catch {
      /* localStorage unavailable */
    }
  }

  // Prefill the rep from a per-rep link: a ?rep= visit is stashed in
  // localStorage by RepCapture, so it survives navigation to the cart.
  // Also prefill contact fields from the last submitted order.
  useEffect(() => {
    try {
      const rep = window.localStorage.getItem('livecatalog_rep')
      const savedRaw = window.localStorage.getItem(LS_CONTACT_KEY)
      const saved: Partial<SavedContact> = savedRaw ? JSON.parse(savedRaw) : {}
      let didPrefill = false
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setContact((c) => {
        const next = { ...c }
        if (rep) next.placedByRep = rep
        if (saved.name) { next.name = saved.name; didPrefill = true }
        if (saved.email) { next.email = saved.email; didPrefill = true }
        if (saved.phone) { next.phone = saved.phone; didPrefill = true }
        if (saved.company) { next.company = saved.company; didPrefill = true }
        if (saved.po_number) { next.poNumber = saved.po_number; didPrefill = true }
        return next
      })
      if (didPrefill) setPreFilled(true)
    } catch {
      /* localStorage unavailable */
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
      const dateNote = requiredShipDate ? `[Needed by ${requiredShipDate}]\n` : ''
      const finalNotes = dateNote + (contact.notes?.trim() ?? '')
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((i) => ({ productId: i.productId, qty: i.qty })),
          contact: { ...contact, notes: finalNotes || undefined },
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.')
      try {
        localStorage.setItem(LS_CONTACT_KEY, JSON.stringify({
          name: contact.name,
          email: contact.email,
          phone: contact.phone ?? '',
          company: contact.company ?? '',
          po_number: contact.poNumber ?? '',
        } satisfies SavedContact))
      } catch {
        /* localStorage unavailable */
      }
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
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-gray-900">Your Order Request</h1>
        {(items.length > 0 || draftNames.length > 0) && (
          <div className="flex flex-wrap items-center gap-3">
            {items.length > 0 && (
              <button
                type="button"
                onClick={handleSaveDraft}
                className="text-sm text-gray-500 hover:text-gray-700 underline"
              >
                {draftSaved ? 'Saved!' : 'Save as draft'}
              </button>
            )}
            {draftNames.length > 0 && (
              <div className="flex items-center gap-1">
                <select
                  onChange={handleLoadDraft}
                  defaultValue=""
                  className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 bg-white text-gray-700 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                >
                  <option value="" disabled>Load draft…</option>
                  {draftNames.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                {draftNames.map((name) => (
                  <button
                    key={name}
                    type="button"
                    aria-label={`Delete draft "${name}"`}
                    onClick={() => handleDeleteDraft(name)}
                    className="ml-0.5 text-xs text-gray-400 hover:text-red-600"
                    title={`Delete draft: ${name}`}
                  >
                    ✕
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Line items */}
        <div className="lg:col-span-2">
          <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
            {items.map((item) => (
              <li key={item.productId} className="flex items-center gap-4 p-4">
                <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-gray-100">
                  {item.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={resolveCdnImage(item.imageUrl, 150) ?? undefined} alt={item.name} className="h-full w-full object-contain" />
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
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm text-blue-800">
              <svg className="mt-0.5 h-4 w-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
              </svg>
              <span>Quote request — no payment is taken. A rep confirms pricing and follows up.</span>
            </div>

            <div className="space-y-3">
              <Field label="Name *" value={contact.name} onChange={(v) => setContact({ ...contact, name: v })} required />
              <Field
                label="Email *"
                type="email"
                value={contact.email}
                onChange={(v) => setContact({ ...contact, email: v })}
                onBlur={() => {
                  const email = contact.email.trim()
                  if (!email || !email.includes('@') || items.length === 0) return
                  fetch('/api/cart-session', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      email,
                      name: contact.name.trim() || undefined,
                      items: items.map((i) => ({ sku: i.sku, name: i.name, qty: i.qty, priceCents: i.priceCents })),
                    }),
                  }).catch(() => {})
                }}
                required
              />
              <Field label="Phone" type="tel" value={contact.phone ?? ''} onChange={(v) => setContact({ ...contact, phone: v })} />
              <Field label="Company" value={contact.company ?? ''} onChange={(v) => setContact({ ...contact, company: v })} />
              <Field label="Placed by (rep)" value={contact.placedByRep ?? ''} onChange={(v) => setContact({ ...contact, placedByRep: v })} />
              <Field label="CC sales rep (email)" type="email" value={contact.ccEmail ?? ''} onChange={(v) => setContact({ ...contact, ccEmail: v })} />
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
              <div>
                <label htmlFor="requiredShipDate" className="mb-1 block text-xs font-medium text-gray-600">
                  Order by date <span className="text-gray-400">(Needed by a specific date?)</span>
                </label>
                <input
                  type="date"
                  id="requiredShipDate"
                  value={requiredShipDate}
                  onChange={(e) => setRequiredShipDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="block rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
              </div>
            </div>

            {preFilled && (
              <p className="mt-3 text-xs text-gray-400">
                Fields pre-filled from your last order.{' '}
                <button
                  type="button"
                  onClick={() => {
                    try { localStorage.removeItem(LS_CONTACT_KEY) } catch {}
                    setContact({ name: '', email: '', phone: '', company: '', poNumber: '', placedByRep: contact.placedByRep })
                    setPreFilled(false)
                  }}
                  className="underline hover:text-gray-600"
                >
                  Clear
                </button>
              </p>
            )}

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
  onBlur,
  type = 'text',
  required = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
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
        onBlur={onBlur}
        className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
      />
    </div>
  )
}
