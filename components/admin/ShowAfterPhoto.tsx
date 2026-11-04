'use client'

import { useState } from 'react'
import { readApiError, TRANSPORT_ERROR } from '@/lib/admin-fetch'

// After a photo upload: the products that just got a photo but are still
// hidden, each with a Show button. Showing is never automatic -- which hidden
// products go on the storefront is the owner's call -- and goes through the
// same audited PATCH as ProductVisibilityToggle, which refuses a $0 product.

export interface HiddenAfterPhoto {
  id: string
  sku: string
  name: string
  priced: boolean
}

type RowState = 'hidden' | 'pending' | 'shown' | { error: string }

async function show(id: string): Promise<string | null> {
  try {
    const res = await fetch('/admin/api/products', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, manually_hidden: false }),
    })
    return await readApiError(res, 'Could not show it.')
  } catch {
    return TRANSPORT_ERROR
  }
}

export default function ShowAfterPhoto({ products }: { products: HiddenAfterPhoto[] }) {
  const [state, setState] = useState<Record<string, RowState>>({})
  const [bulkBusy, setBulkBusy] = useState(false)
  const stateOf = (id: string): RowState => state[id] ?? 'hidden'
  const set = (id: string, s: RowState) => setState((prev) => ({ ...prev, [id]: s }))

  async function showOne(id: string) {
    set(id, 'pending')
    const err = await show(id)
    set(id, err ? { error: err } : 'shown')
  }

  // One at a time: each is its own audited write, and a failure on one
  // shouldn't stop the rest.
  async function showAll() {
    setBulkBusy(true)
    for (const p of products) {
      const s = stateOf(p.id)
      if (p.priced && (s === 'hidden' || typeof s === 'object')) await showOne(p.id)
    }
    setBulkBusy(false)
  }

  if (products.length === 0) return null
  const priced = products.filter((p) => p.priced)
  const waiting = priced.filter((p) => stateOf(p.id) !== 'shown').length

  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-amber-900">
          {products.length} of these {products.length === 1 ? 'is' : 'are'} still hidden from the storefront.
          {priced.length < products.length && ` ${products.length - priced.length} at $0 stay hidden until priced.`}
        </p>
        {waiting > 1 && (
          <button
            type="button"
            onClick={showAll}
            disabled={bulkBusy}
            className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {bulkBusy ? 'Showing…' : `Show all ${waiting} priced`}
          </button>
        )}
      </div>
      <ul className="mt-2 divide-y divide-amber-100">
        {products.map((p) => {
          const s = stateOf(p.id)
          return (
            <li key={p.id} className="flex items-center justify-between gap-3 py-1.5 text-xs">
              <span className="min-w-0">
                <span className="font-mono font-semibold text-gray-900">{p.sku}</span>{' '}
                <span className="text-gray-700">{p.name}</span>
                {typeof s === 'object' && <span className="block text-red-600">{s.error}</span>}
              </span>
              {!p.priced ? (
                <span className="shrink-0 text-gray-500">$0: stays hidden</span>
              ) : s === 'shown' ? (
                <span className="shrink-0 font-semibold text-green-700">On the storefront</span>
              ) : (
                <button
                  type="button"
                  onClick={() => showOne(p.id)}
                  disabled={s === 'pending' || bulkBusy}
                  className="shrink-0 rounded-full bg-white border border-gray-300 px-3 py-0.5 font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {s === 'pending' ? '…' : 'Show'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
