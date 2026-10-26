'use client'

import { useState } from 'react'
import { readApiError, TRANSPORT_ERROR } from '@/lib/admin-fetch'

// There is deliberately no bulk "re-enable products with an image": hidden
// is not a reason, and about 1,200 priced products with photos are hidden on
// purpose. Unhiding is per product (/admin/products) or, for products hidden
// only for want of a price, Ready to show in /admin/cleanup?issue=pricing.
type Action = 'hide_imageless'

interface Note {
  action: Action
  affected: number
}

export default function BulkVisibilityActions() {
  const [pending, setPending] = useState<Action | null>(null)
  const [note, setNote] = useState<Note | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(action: Action) {
    setPending(action)
    setNote(null)
    setError(null)
    try {
      const res = await fetch('/admin/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const err = await readApiError(res, 'Request failed.')
      if (err) {
        setError(err)
        return
      }
      const data = await res.json()
      setNote({ action, affected: data.affected ?? 0 })
    } catch {
      setError(TRANSPORT_ERROR)
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          onClick={() => run('hide_imageless')}
          disabled={pending !== null}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {pending === 'hide_imageless' ? 'Hiding…' : 'Hide all products without an image'}
        </button>
      </div>

      {note && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-2 text-sm text-green-700">
          ✓ Hid {note.affected} product{note.affected !== 1 ? 's' : ''} without an image.
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  )
}
