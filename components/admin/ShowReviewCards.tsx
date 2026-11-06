'use client'

import { useState } from 'react'
import { readApiError, TRANSPORT_ERROR } from '@/lib/admin-fetch'

// Cards for /admin/show-review. Show -> PATCH /admin/api/products (logged as
// product_visibility_changed, refuses $0); Keep hidden / Reopen ->
// POST /admin/api/show-review. State is updated in place so the owner can
// work down the list without reloads.

export interface ShowCard {
  id: string
  sku: string
  name: string
  description: string
  priceCents: number
  stock: number
  category: string
  searches: number
  thumb: string | null
  kept: boolean
}

type Status = 'open' | 'shown' | 'kept'

export default function ShowReviewCards({ cards }: { cards: ShowCard[] }) {
  const [status, setStatus] = useState<Record<string, Status>>(() =>
    Object.fromEntries(cards.map((c) => [c.id, c.kept ? 'kept' : 'open'])),
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<Record<string, string>>({})
  const [view, setView] = useState<Status>('open')

  async function act(card: ShowCard, kind: 'show' | 'hide-again' | 'keep' | 'reopen') {
    setBusy(card.id)
    setError((e) => ({ ...e, [card.id]: '' }))
    try {
      const res =
        kind === 'show' || kind === 'hide-again'
          ? await fetch('/admin/api/products', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: card.id, manually_hidden: kind === 'hide-again' }),
            })
          : await fetch('/admin/api/show-review', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: card.id, action: kind }),
            })
      const err = await readApiError(res, 'Could not save.')
      if (err) return setError((e) => ({ ...e, [card.id]: err }))
      setStatus((s) => ({ ...s, [card.id]: kind === 'show' ? 'shown' : kind === 'keep' ? 'kept' : 'open' }))
    } catch {
      setError((e) => ({ ...e, [card.id]: TRANSPORT_ERROR }))
    } finally {
      setBusy(null)
    }
  }

  const count = (s: Status) => cards.filter((c) => status[c.id] === s).length
  const shown = cards.filter((c) => status[c.id] === view)
  const tab = (s: Status, label: string) => (
    <button
      type="button"
      onClick={() => setView(s)}
      className={'rounded-md px-3 py-1.5 text-sm font-semibold ' + (view === s ? 'bg-red-600 text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50')}
    >
      {label} ({count(s)})
    </button>
  )

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        {tab('open', 'To decide')}
        {tab('shown', 'Shown now')}
        {tab('kept', 'Kept hidden')}
      </div>
      {shown.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white px-6 py-12 text-center text-sm text-gray-400">Nothing here.</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {shown.map((c) => (
            <div key={c.id} className="flex gap-4 rounded-xl border border-gray-200 bg-white p-4">
              {c.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.thumb} alt="" className="h-28 w-28 shrink-0 rounded-lg bg-gray-100 object-contain" />
              ) : (
                <div className="h-28 w-28 shrink-0 rounded-lg bg-gray-100" />
              )}
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-mono text-xs text-gray-500">{c.sku}</p>
                <p className="font-semibold text-gray-900">{c.name}</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  ${(c.priceCents / 100).toFixed(2)} · stock {c.stock.toLocaleString()} · {c.category}
                  {c.searches > 0 && <span className="font-semibold text-amber-700"> · searched {c.searches}×</span>}
                </p>
                <p className="mt-1.5 line-clamp-3 text-gray-700">{c.description}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {status[c.id] === 'open' && (
                    <>
                      <button type="button" disabled={busy === c.id} onClick={() => act(c, 'show')} className="rounded-md bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50">
                        Show
                      </button>
                      <button type="button" disabled={busy === c.id} onClick={() => act(c, 'keep')} className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                        Keep hidden
                      </button>
                    </>
                  )}
                  {status[c.id] === 'shown' && (
                    <button type="button" disabled={busy === c.id} onClick={() => act(c, 'hide-again')} className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                      Undo (hide again)
                    </button>
                  )}
                  {status[c.id] === 'kept' && (
                    <button type="button" disabled={busy === c.id} onClick={() => act(c, 'reopen')} className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50">
                      Put back on the list
                    </button>
                  )}
                </div>
                {error[c.id] && <p className="mt-1 text-xs text-red-600">{error[c.id]}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
