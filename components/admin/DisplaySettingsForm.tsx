'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DisplaySettings } from '@/lib/display-settings'

interface Row {
  label: string
  listingField: keyof DisplaySettings
  detailField: keyof DisplaySettings
}

const ROWS: Row[] = [
  { label: 'Stock badge / quantity', listingField: 'show_stock_listing', detailField: 'show_stock_detail' },
  { label: 'SKU / barcode', listingField: 'show_sku_barcode_listing', detailField: 'show_sku_barcode_detail' },
  { label: 'Category label', listingField: 'show_category_listing', detailField: 'show_category_detail' },
  { label: 'Pack size / case info', listingField: 'show_pack_info_listing', detailField: 'show_pack_info_detail' },
]

interface Props {
  initialSettings: DisplaySettings
}

export default function DisplaySettingsForm({ initialSettings }: Props) {
  const router = useRouter()
  const [settings, setSettings] = useState(initialSettings)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ message: string; ok: boolean } | null>(null)

  function toggle(field: keyof DisplaySettings) {
    setSettings((prev) => ({ ...prev, [field]: !prev[field] }))
    setResult(null)
  }

  async function save() {
    setSaving(true)
    setResult(null)
    try {
      const res = await fetch('/admin/api/display-settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Save failed')
      setResult({ message: 'Saved.', ok: true })
      router.refresh()
    } catch (err) {
      setResult({ message: err instanceof Error ? err.message : 'Save failed', ok: false })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl bg-white border border-gray-200 overflow-hidden">
      <table className="w-full text-sm text-left">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Element</th>
            <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-center">Main pages</th>
            <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide text-center">Product pages</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {ROWS.map((row) => (
            <tr key={row.label}>
              <td className="px-4 py-3 text-gray-800">{row.label}</td>
              <td className="px-4 py-3 text-center">
                <input
                  type="checkbox"
                  checked={settings[row.listingField]}
                  onChange={() => toggle(row.listingField)}
                  className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                  aria-label={`${row.label} on main pages`}
                />
              </td>
              <td className="px-4 py-3 text-center">
                <input
                  type="checkbox"
                  checked={settings[row.detailField]}
                  onChange={() => toggle(row.detailField)}
                  className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
                  aria-label={`${row.label} on product pages`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex items-center justify-end gap-3 border-t border-gray-100 px-4 py-3">
        {result && (
          <span className={`text-sm ${result.ok ? 'text-green-600' : 'text-red-600'}`}>{result.message}</span>
        )}
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}
