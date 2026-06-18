'use client'

import { useState } from 'react'

interface Props {
  id: string
  initialHidden: boolean
}

export default function ProductVisibilityToggle({ id, initialHidden }: Props) {
  const [hidden, setHidden] = useState(initialHidden)
  const [pending, setPending] = useState(false)

  async function toggle() {
    const next = !hidden
    setPending(true)
    setHidden(next) // optimistic
    try {
      const res = await fetch('/admin/api/products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, manually_hidden: next }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Request failed')
    } catch {
      setHidden(!next) // revert
    } finally {
      setPending(false)
    }
  }

  return (
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
  )
}
