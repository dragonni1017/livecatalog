'use client'

import { useState } from 'react'
import { readApiError, TRANSPORT_ERROR } from '@/lib/admin-fetch'

interface Props {
  id: string
  initialHidden: boolean
}

export default function ProductVisibilityToggle({ id, initialHidden }: Props) {
  const [hidden, setHidden] = useState(initialHidden)
  const [pending, setPending] = useState(false)
  // Shown, not swallowed: the route refuses to show a $0 product, and a
  // toggle that silently flips back would look broken.
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    const next = !hidden
    setPending(true)
    setError(null)
    setHidden(next) // optimistic
    try {
      const res = await fetch('/admin/api/products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, manually_hidden: next }),
      })
      const err = await readApiError(res, 'Request failed.')
      if (err) {
        setHidden(!next) // revert
        setError(err)
      }
    } catch {
      setHidden(!next) // revert
      setError(TRANSPORT_ERROR)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        onClick={toggle}
        disabled={pending}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
          hidden
            ? 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            : 'bg-green-100 text-green-700 hover:bg-green-200'
        }`}
        title={hidden ? 'Click to make visible' : 'Click to hide'}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${hidden ? 'bg-gray-400' : 'bg-green-500'}`} />
        {pending ? '…' : hidden ? 'Hidden' : 'Visible'}
      </button>
      {error && <p className="max-w-[16rem] text-xs text-red-600">{error}</p>}
    </div>
  )
}
