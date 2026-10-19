'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useCart, formatPrice } from '@/lib/cart-context'
import { resolveCdnImage } from '@/lib/image'
import { meetsOrderMinimum, MIN_ORDER_SUBTOTAL_CENTS } from '@/lib/order-rules'
import { track } from '@/lib/track'
import { addressSummary, sameAddress, type AddressInput, type CustomerAddress } from '@/lib/customer-addresses'
import { normalizeUsState } from '@/lib/us-states'
import { TAX_ESTIMATE_NOTE, type TaxEstimate } from '@/lib/sales-tax'
import StateSelect from '@/components/catalog/StateSelect'
import type { CartItem, CheckoutContact } from '@/lib/types'

interface SavedContact {
  name: string
  email: string
  phone: string
  company: string
  po_number: string
  ship_address1: string
  ship_address2: string
  ship_city: string
  ship_state: string
  ship_zip: string
}

const LS_CONTACT_KEY = 'lyu_contact'
const LS_DRAFTS_KEY = 'lyu_drafts'
// Separate from LS_CONTACT_KEY (which only stores reusable contact/shipping
// fields, written at submit time): this is a live draft of the order-specific
// notes + ship-by date, saved on every keystroke so they survive the customer
// navigating away to keep shopping and coming back before submitting.
const LS_NOTES_DRAFT_KEY = 'lyu_order_notes_draft'

export default function CartPage() {
  const { items, subtotalCents, count, setQty, removeItem, clear, addItem, updatePrices, hydrated } = useCart()
  const [contact, setContact] = useState<CheckoutContact>({ name: '', email: '' })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<{ referenceCode: string } | null>(null)
  const [preFilled, setPreFilled] = useState(false)
  const [draftNames, setDraftNames] = useState<string[]>([])
  const [draftSaved, setDraftSaved] = useState(false)
  const [requiredShipDate, setRequiredShipDate] = useState('')
  const [reps, setReps] = useState<string[]>([])
  const [notesHydrated, setNotesHydrated] = useState(false)

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

  // Funnel step "opened cart": once per browser session, and only with
  // something in it, since an empty cart isn't a step toward a quote.
  const cartViewTracked = useRef(false)
  useEffect(() => {
    if (!hydrated || items.length === 0 || cartViewTracked.current) return
    cartViewTracked.current = true
    try {
      if (sessionStorage.getItem('tracked_cart_view')) return
      sessionStorage.setItem('tracked_cart_view', '1')
    } catch {
      // sessionStorage unavailable — still track, just without dedupe.
    }
    track({ type: 'cart_view' })
  }, [hydrated, items.length])

  // Restore any in-progress notes / ship-by date from a previous visit this
  // order, same one-time-hydration pattern as the cart itself (lib/cart-context).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LS_NOTES_DRAFT_KEY)
      const draft: { notes?: string; requiredShipDate?: string } = raw ? JSON.parse(raw) : {}
      if (draft.notes) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setContact((c) => ({ ...c, notes: draft.notes }))
      }
      if (draft.requiredShipDate) {
        setRequiredShipDate(draft.requiredShipDate)
      }
    } catch {
      /* localStorage unavailable */
    } finally {
      setNotesHydrated(true)
    }
  }, [])

  // Save the notes/ship-by draft on every change, once hydration above has
  // run (otherwise the initial empty state would overwrite a saved draft
  // before it's had a chance to load).
  useEffect(() => {
    if (!notesHydrated) return
    try {
      if (contact.notes || requiredShipDate) {
        window.localStorage.setItem(
          LS_NOTES_DRAFT_KEY,
          JSON.stringify({ notes: contact.notes ?? '', requiredShipDate }),
        )
      } else {
        window.localStorage.removeItem(LS_NOTES_DRAFT_KEY)
      }
    } catch {
      /* localStorage unavailable */
    }
  }, [contact.notes, requiredShipDate, notesHydrated])

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

  // Re-syncs displayed prices against the current session on cart mount and
  // on pageshow (fires on bfcache restores too, e.g. pressing Back after
  // signing out) — priceCents is frozen at add-time (see lib/cart-context),
  // so without this, an item added at a rep's tier discount kept showing
  // that discounted price in the cart indefinitely, even after logout. Uses
  // a ref so the effect (mount + pageshow only) always reads the latest
  // items without re-firing every time the cart itself changes.
  const itemsRef = useRef(items)
  useEffect(() => {
    itemsRef.current = items
  }, [items])

  useEffect(() => {
    function reprice() {
      // Rep custom-priced lines are excluded from the request entirely --
      // the server only ever returns prices for productIds it was asked
      // about, so this keeps updatePrices() from touching them at all.
      const current = itemsRef.current.filter((i) => !i.isCustomPrice)
      if (current.length === 0) return
      fetch('/api/cart/reprice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: current.map((i) => ({ productId: i.productId, qty: i.qty })) }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data.prices) updatePrices(data.prices)
        })
        .catch(() => {})
    }
    if (hydrated) reprice()
    window.addEventListener('pageshow', reprice)
    return () => window.removeEventListener('pageshow', reprice)
  }, [hydrated, updatePrices])

  // "Placed by (rep)" is a dropdown of real rep accounts, not free text —
  // fetch the list once. Public/unauthenticated endpoint, same as the
  // ?rep= link and "CC sales rep" field already expose rep emails.
  //
  // A ?rep= link (or a saved value from a prior order) only pre-selects the
  // dropdown if it exactly matches a real, currently active rep — otherwise
  // it's cleared rather than silently submitting an unlisted value. Done in
  // the fetch callback (it always resolves after the mount-time prefill below
  // has run), not in an effect keyed on `reps`, which would set state
  // synchronously inside an effect.
  useEffect(() => {
    fetch('/api/reps')
      .then((res) => res.json())
      .then((data) => {
        const list: string[] = Array.isArray(data.reps) ? data.reps : []
        setReps(list)
        if (list.length === 0) return
        setContact((c) =>
          c.placedByRep && !list.includes(c.placedByRep) ? { ...c, placedByRep: '' } : c,
        )
      })
      .catch(() => {})
  }, [])

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
        if (saved.ship_address1) { next.shipAddress1 = saved.ship_address1; didPrefill = true }
        if (saved.ship_address2) { next.shipAddress2 = saved.ship_address2; didPrefill = true }
        if (saved.ship_city) { next.shipCity = saved.ship_city; didPrefill = true }
        // Older saved contacts may hold free text ("Texas"); keep the code.
        if (saved.ship_state) { next.shipState = normalizeUsState(saved.ship_state) ?? saved.ship_state; didPrefill = true }
        if (saved.ship_zip) { next.shipZip = saved.ship_zip; didPrefill = true }
        return next
      })
      if (didPrefill) setPreFilled(true)
    } catch {
      /* localStorage unavailable */
    }
  }, [])

  // Signed-in buyers' saved ship-to addresses (migration 0058). null = guest
  // or not loaded, so the picker and "save" checkbox don't show. A 401 is the
  // normal guest case, not an error.
  const [savedAddresses, setSavedAddresses] = useState<CustomerAddress[] | null>(null)
  const [saveToBook, setSaveToBook] = useState(false)
  useEffect(() => {
    let cancelled = false
    fetch('/api/account/addresses')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { addresses: CustomerAddress[] } | null) => {
        if (cancelled || !data) return
        setSavedAddresses(data.addresses)
        // The saved default wins over the last-order address from localStorage.
        const def = data.addresses.find((a) => a.is_default)
        if (def) {
          setContact((c) => ({
            ...c,
            shipAddress1: def.address1,
            shipAddress2: def.address2 ?? '',
            shipCity: def.city,
            shipState: def.state,
            shipZip: def.zip,
          }))
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const typedAddress: AddressInput = {
    label: null,
    address1: contact.shipAddress1 ?? '',
    address2: contact.shipAddress2 || null,
    city: contact.shipCity ?? '',
    state: contact.shipState ?? '',
    zip: contact.shipZip ?? '',
  }
  // Which saved address the fields currently hold, if any. Derived rather than
  // stored, so typing over a picked address simply un-selects it.
  const matchedAddressId = savedAddresses?.find((a) => sameAddress(a, typedAddress))?.id ?? ''
  const addressComplete = !!(typedAddress.address1.trim() && typedAddress.city.trim() && typedAddress.state.trim() && typedAddress.zip.trim())
  const canSaveAddress = savedAddresses !== null && addressComplete && !matchedAddressId

  function pickSavedAddress(id: string) {
    const a = savedAddresses?.find((x) => x.id === id)
    if (!a) return
    setContact({ ...contact, shipAddress1: a.address1, shipAddress2: a.address2 ?? '', shipCity: a.city, shipState: a.state, shipZip: a.zip })
  }

  // ── Promo code (lib/promotions.ts) ─────────────────────────────────────────
  // Checked with its own reprice call that includes hand-priced rep lines
  // (flagged), reading only the promo result so item prices stay untouched.
  // The order route re-checks and recomputes everything server-side.
  const [promoInput, setPromoInput] = useState('')
  const [promoCode, setPromoCode] = useState<string | null>(null)
  const [promo, setPromo] = useState<{ code: string; applied: boolean; discountCents: number; percentOff?: number; reason?: string } | null>(null)
  const promoKey = items.map((i) => `${i.productId}:${i.qty}:${i.isCustomPrice ? 1 : 0}`).join('|')
  useEffect(() => {
    if (!promoCode || !hydrated) return
    let cancelled = false
    fetch('/api/cart/reprice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        promoCode,
        items: items.map((i) => ({ productId: i.productId, qty: i.qty, customPrice: !!i.isCustomPrice })),
      }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.promo) setPromo(data.promo)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- promoKey captures the items that matter
  }, [promoCode, promoKey, hydrated])
  const promoDiscount = promo?.applied ? promo.discountCents : 0
  const estimatedTotal = subtotalCents - promoDiscount

  // ── Estimated sales tax (lib/sales-tax.ts) ─────────────────────────────────
  // Shown once a ship-to state is picked. Display only: the order route
  // recomputes and saves its own estimate, and QuickBooks charges the real
  // tax. Nothing shows for a state where tax isn't collected.
  // Each result is kept with the inputs it was computed for and only shown
  // while those still match, so a stale estimate never sits under a new total.
  const [taxResult, setTaxResult] = useState<{ key: string; tax: TaxEstimate | null } | null>(null)
  const taxState = contact.shipState?.trim() ?? ''
  const taxEmail = contact.email.trim()
  const taxKey = `${taxState}|${estimatedTotal}|${taxEmail.toLowerCase()}`
  useEffect(() => {
    if (!hydrated || !taxState || estimatedTotal <= 0) return
    let cancelled = false
    const t = setTimeout(() => {
      fetch('/api/cart/tax-estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipState: taxState, subtotalCents: estimatedTotal, email: taxEmail || undefined }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!cancelled) setTaxResult({ key: taxKey, tax: data?.tax ?? null })
        })
        .catch(() => {})
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [hydrated, taxState, taxEmail, estimatedTotal, taxKey])
  const tax = taxState && estimatedTotal > 0 && taxResult?.key === taxKey ? taxResult.tax : null
  const taxCents = tax && !tax.exemptReason ? tax.taxCents : 0
  const showTax = !!tax && tax.exemptReason !== 'not_collected'

  const belowMinimum = !meetsOrderMinimum(estimatedTotal)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!contact.name.trim() || !contact.email.trim()) {
      setError('Name and email are required.')
      return
    }
    if (!contact.shipAddress1?.trim() || !contact.shipCity?.trim() || !contact.shipState?.trim() || !contact.shipZip?.trim()) {
      setError('A shipping address (street, city, state, ZIP) is required.')
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
      const dateNote = requiredShipDate ? `[Ship by ${requiredShipDate}]\n` : ''
      const finalNotes = dateNote + (contact.notes?.trim() ?? '')
      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((i) => ({
            productId: i.productId,
            qty: i.qty,
            ...(i.isCustomPrice ? { unitPriceOverrideCents: i.priceCents } : {}),
          })),
          contact: { ...contact, notes: finalNotes || undefined },
          // Only a code that applies is sent; one that saves nothing is left off.
          ...(promo?.applied ? { promoCode: promo.code } : {}),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.')
      if (canSaveAddress && saveToBook) {
        // Best-effort: the order is already in, so a failure here only means
        // the address isn't saved for next time.
        fetch('/api/account/addresses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(typedAddress),
          keepalive: true,
        }).catch(() => {})
      }
      try {
        localStorage.setItem(LS_CONTACT_KEY, JSON.stringify({
          name: contact.name,
          email: contact.email,
          phone: contact.phone ?? '',
          company: contact.company ?? '',
          po_number: contact.poNumber ?? '',
          ship_address1: contact.shipAddress1 ?? '',
          ship_address2: contact.shipAddress2 ?? '',
          ship_city: contact.shipCity ?? '',
          ship_state: contact.shipState ?? '',
          ship_zip: contact.shipZip ?? '',
        } satisfies SavedContact))
      } catch {
        /* localStorage unavailable */
      }
      try {
        localStorage.removeItem(LS_NOTES_DRAFT_KEY)
      } catch {
        /* localStorage unavailable */
      }
      clear()
      setPromoCode(null)
      setPromo(null)
      setPromoInput('')
      setConfirmed({ referenceCode: data.referenceCode })
      track({ type: 'quote_submitted' })
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
                  <p className="text-sm text-gray-700">
                    {formatPrice(item.priceCents)} each
                    {item.isCustomPrice && (
                      <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                        Custom price
                      </span>
                    )}
                  </p>
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
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm text-gray-600">Subtotal</span>
              <span className={promoDiscount || showTax ? 'text-sm text-gray-700' : 'text-lg font-bold text-gray-900'}>{formatPrice(subtotalCents)}</span>
            </div>
            {promoDiscount > 0 && promo && (
              <div className="mb-1 flex items-center justify-between text-sm text-green-700">
                <span>
                  Promo {promo.code}
                  {promo.percentOff ? ` (${promo.percentOff}% off eligible items)` : ''}
                </span>
                <span className="ml-2 whitespace-nowrap">−{formatPrice(promoDiscount)}</span>
              </div>
            )}
            {showTax && tax && (
              <div className="mb-1 text-sm text-gray-700">
                <div className="flex items-center justify-between">
                  <span>
                    {tax.exemptReason === 'resale_certificate'
                      ? `Sales tax: exempt (resale certificate, ${tax.state})`
                      : `Estimated sales tax (${tax.state} ${tax.ratePercent}%)`}
                  </span>
                  <span className="ml-2 whitespace-nowrap">{formatPrice(taxCents)}</span>
                </div>
                {tax.certificatePending && (
                  <p className="mt-0.5 text-xs text-amber-700">
                    Your resale certificate is pending review. Tax comes off once it&apos;s verified.
                  </p>
                )}
              </div>
            )}
            {(promoDiscount > 0 || showTax) && (
              <div className="mb-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Estimated total</span>
                  <span className="text-lg font-bold text-gray-900">{formatPrice(estimatedTotal + taxCents)}</span>
                </div>
                {showTax && <p className="text-xs text-gray-500">{TAX_ESTIMATE_NOTE}</p>}
              </div>
            )}
            <div className="mb-4">
              {promoCode ? (
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className={promo?.applied ? 'text-green-700' : 'text-amber-700'}>
                    {promo ? (promo.applied ? `${promo.code} applied` : promo.reason ?? `${promo.code} doesn't apply`) : `Checking ${promoCode}…`}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setPromoCode(null)
                      setPromo(null)
                      setPromoInput('')
                    }}
                    className="text-gray-500 underline hover:text-gray-700"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    value={promoInput}
                    onChange={(e) => setPromoInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        if (promoInput.trim()) setPromoCode(promoInput.trim().toUpperCase())
                      }
                    }}
                    placeholder="Promo code"
                    maxLength={32}
                    aria-label="Promo code"
                    className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm uppercase placeholder:normal-case"
                  />
                  <button
                    type="button"
                    disabled={!promoInput.trim()}
                    onClick={() => setPromoCode(promoInput.trim().toUpperCase())}
                    className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-gray-400 disabled:opacity-50"
                  >
                    Apply
                  </button>
                </div>
              )}
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
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">Placed by (rep)</label>
                <select
                  value={contact.placedByRep ?? ''}
                  onChange={(e) => setContact({ ...contact, placedByRep: e.target.value })}
                  className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                >
                  <option value="">— None —</option>
                  {reps.map((rep) => (
                    <option key={rep} value={rep}>{rep}</option>
                  ))}
                </select>
              </div>
              <Field label="CC sales rep (email)" type="email" value={contact.ccEmail ?? ''} onChange={(v) => setContact({ ...contact, ccEmail: v })} />
              <Field label="PO number" value={contact.poNumber ?? ''} onChange={(v) => setContact({ ...contact, poNumber: v })} />
              {savedAddresses && savedAddresses.length > 0 && (
                <div>
                  <label htmlFor="savedAddress" className="mb-1 block text-xs font-medium text-gray-600">
                    Ship to a saved address
                  </label>
                  <select
                    id="savedAddress"
                    value={matchedAddressId}
                    onChange={(e) => pickSavedAddress(e.target.value)}
                    className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                  >
                    <option value="" disabled>
                      {addressComplete ? 'A different address (typed below)' : 'Choose an address…'}
                    </option>
                    {savedAddresses.map((a) => (
                      <option key={a.id} value={a.id}>
                        {addressSummary(a)}
                        {a.is_default ? ' (default)' : ''}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-gray-400">
                    Manage addresses on <Link href="/account" className="underline hover:text-gray-600">your account</Link>.
                  </p>
                </div>
              )}
              <Field
                label="Ship to — address *"
                value={contact.shipAddress1 ?? ''}
                onChange={(v) => setContact({ ...contact, shipAddress1: v })}
                required
              />
              <Field
                label="Address line 2"
                value={contact.shipAddress2 ?? ''}
                onChange={(v) => setContact({ ...contact, shipAddress2: v })}
              />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Field label="City *" value={contact.shipCity ?? ''} onChange={(v) => setContact({ ...contact, shipCity: v })} required />
                <div>
                  <label htmlFor="shipState" className="mb-1 block text-xs font-medium text-gray-600">State *</label>
                  <StateSelect id="shipState" value={contact.shipState ?? ''} onChange={(v) => setContact({ ...contact, shipState: v })} required />
                </div>
                <Field label="ZIP *" value={contact.shipZip ?? ''} onChange={(v) => setContact({ ...contact, shipZip: v })} required />
              </div>
              {canSaveAddress && (
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={saveToBook}
                    onChange={(e) => setSaveToBook(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                  />
                  Save this address to my address book
                </label>
              )}
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
                  Ship by date <span className="text-gray-400">(Needed by a specific date?)</span>
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
                    setContact({
                      name: '', email: '', phone: '', company: '', poNumber: '',
                      shipAddress1: '', shipAddress2: '', shipCity: '', shipState: '', shipZip: '',
                      placedByRep: contact.placedByRep,
                    })
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
                {formatPrice(MIN_ORDER_SUBTOTAL_CENTS - estimatedTotal)} more to submit.
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
