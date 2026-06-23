'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { OrderStatus } from '@/lib/types'

const OPTIONS: { value: OrderStatus; label: string; active: string }[] = [
  { value: 'new', label: 'New', active: 'bg-blue-600 text-white' },
  { value: 'contacted', label: 'Contacted', active: 'bg-amber-600 text-white' },
  { value: 'converted', label: 'Converted', active: 'bg-green-600 text-white' },
  { value: 'lost', label: 'Lost', active: 'bg-gray-600 text-white' },
]

interface Props {
  id: string
  initialStatus: OrderStatus
}

export default function OrderStatusControls({ id, initialStatus }: Props) {
  const router = useRouter()
  const [status, setStatus] = useState<OrderStatus>(initialStatus)
  const [pending, setPending] = useState<OrderStatus | null>(null)
  const [error, setError] = useState(false)

  async function update(next: OrderStatus) {
    if (next === status || pending) return
    const prev = status
    setPending(next)
    setError(false)
    setStatus(next) // optimistic
    try {
      const res = await fetch('/admin/api/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: next }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Request failed')
      router.refresh() // re-pull status_changed_at etc. from the server
    } catch {
      setStatus(prev) // revert
      setError(true)
    } finally {
      setPending(null)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map((opt) => {
          const isCurrent = status === opt.value
          return (
            <button
              key={opt.value}
              onClick={() => update(opt.value)}
              disabled={pending !== null}
              className={
                'rounded-md px-3 py-1.5 text-sm font-semibold transition-colors disabled:opacity-50 ' +
                (isCurrent ? opt.active : 'bg-gray-100 text-gray-600 hover:bg-gray-200')
              }
            >
              {pending === opt.value ? '…' : opt.label}
            </button>
          )
        })}
      </div>
      {error && <p className="mt-2 text-sm text-red-600">Couldn’t update status. Please try again.</p>}
    </div>
  )
}
