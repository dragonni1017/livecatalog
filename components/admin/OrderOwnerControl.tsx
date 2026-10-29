'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { readApiError } from '@/lib/admin-fetch'

interface Props {
  id: string
  owner: string | null
  /** Rep account emails (app_metadata.role = 'rep'). */
  reps: string[]
}

// Who follows up this order (order_requests.assigned_rep_email). Only
// changes the owner: no email, status, stock or QuickBooks effect.
export default function OrderOwnerControl({ id, owner, reps }: Props) {
  const router = useRouter()
  const [value, setValue] = useState(owner ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // An owner that is no longer a rep account still shows, so it isn't silently dropped.
  const options = owner && !reps.some((r) => r.toLowerCase() === owner.toLowerCase()) ? [owner, ...reps] : reps

  async function change(next: string) {
    if (busy) return
    const prev = value
    setValue(next)
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/admin/api/orders/owner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, email: next || null }),
      })
      const err = await readApiError(res, 'Request failed.')
      if (err) {
        setValue(prev)
        setError(err)
        return
      }
      router.refresh()
    } catch {
      setValue(prev)
      setError('Network error. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <select
        value={value}
        onChange={(e) => change(e.target.value)}
        disabled={busy}
        className="rounded-md border border-gray-300 bg-white py-1.5 pl-2 pr-7 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500 disabled:opacity-50"
      >
        <option value="">Unassigned</option>
        {options.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  )
}
