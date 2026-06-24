'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Props {
  id: string
  initial: boolean
  // 'button' = standalone pill (order detail); 'cell' = compact (orders list).
  variant?: 'button' | 'cell'
}

// Toggles an order's "entered in QuickBooks" flag. Optimistic, with revert on
// failure. Hits PATCH /admin/api/orders { id, enteredInQb }.
export default function EnteredInQbToggle({ id, initial, variant = 'button' }: Props) {
  const router = useRouter()
  const [entered, setEntered] = useState(initial)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)

  async function toggle() {
    if (pending) return
    const next = !entered
    setPending(true)
    setError(false)
    setEntered(next) // optimistic
    try {
      const res = await fetch('/admin/api/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, enteredInQb: next }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Request failed')
      router.refresh()
    } catch {
      setEntered(!next) // revert
      setError(true)
    } finally {
      setPending(false)
    }
  }

  const label = entered ? 'In QuickBooks ✓' : 'Mark entered in QB'
  const cls = entered
    ? 'bg-green-600 text-white hover:bg-green-700'
    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'

  if (variant === 'cell') {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        title={error ? 'Update failed — try again' : undefined}
        className={'rounded-md px-2.5 py-1 text-xs font-semibold transition-colors disabled:opacity-50 ' + cls}
      >
        {pending ? '…' : entered ? '✓ QB' : 'Mark QB'}
      </button>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className={'rounded-md px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ' + cls}
      >
        {pending ? '…' : label}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">Couldn’t update. Please try again.</p>}
    </div>
  )
}
