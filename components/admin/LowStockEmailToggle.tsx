'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { readApiError, TRANSPORT_ERROR } from '@/lib/admin-fetch'

// On/off for the low-stock reorder email (lib/alert-settings.ts). Saves on click.
// recipientSet: REORDER_ALERT_TO (and SMTP) configured; without it the switch
// can be on and still send nothing, so say so.
export default function LowStockEmailToggle({ initialEnabled, recipientSet = true }: { initialEnabled: boolean; recipientSet?: boolean }) {
  const router = useRouter()
  const [enabled, setEnabled] = useState(initialEnabled)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle() {
    const next = !enabled
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/admin/api/alert-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ low_stock_email_enabled: next }),
      })
      const err = await readApiError(res, 'Save failed.')
      if (err) {
        setError(err)
        return
      }
      setEnabled(next)
      router.refresh()
    } catch {
      setError(TRANSPORT_ERROR)
    } finally {
      setSaving(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-2 rounded-lg bg-white border border-gray-200 px-4 py-2 text-gray-700">
      <label className="inline-flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          disabled={saving}
          onChange={toggle}
          className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
        />
        Low-stock email {enabled ? 'on' : 'off'}
      </label>
      {!recipientSet ? (
        <span className="text-xs text-amber-700">(no recipient set in Vercel: REORDER_ALERT_TO, so nothing is sent)</span>
      ) : (
        !enabled && <span className="text-xs text-gray-400">(low stock still shows here)</span>
      )}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  )
}
