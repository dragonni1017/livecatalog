'use client'

import { useState } from 'react'

type Action = 'hide_imageless' | 'unhide_with_image'

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
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Request failed')
      setNote({ action, affected: data.affected ?? 0 })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
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
        <button
          onClick={() => run('unhide_with_image')}
          disabled={pending !== null}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {pending === 'unhide_with_image' ? 'Re-enabling…' : 'Re-enable products that now have an image'}
        </button>
      </div>

      {note && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-2 text-sm text-green-700">
          ✓ {note.action === 'hide_imageless'
            ? `Hid ${note.affected} product${note.affected !== 1 ? 's' : ''} without an image.`
            : `Re-enabled ${note.affected} product${note.affected !== 1 ? 's' : ''} that now have an image.`}
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
