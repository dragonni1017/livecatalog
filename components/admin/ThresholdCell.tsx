'use client'

import { useState } from 'react'

interface Product {
  id: string
  low_stock_threshold: number | null
}

interface ThresholdCellProps {
  product: Product
  onSaved: () => void
}

export default function ThresholdCell({ product, onSaved }: ThresholdCellProps) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(
    product.low_stock_threshold !== null ? String(product.low_stock_threshold) : '',
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(newThreshold: number | null) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/admin/api/products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: product.id, low_stock_threshold: newThreshold }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Save failed')
      setEditing(false)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleSave() {
    if (value === '') {
      await save(null)
    } else {
      const n = parseInt(value, 10)
      if (!Number.isInteger(n) || n < 0) {
        setError('Enter a non-negative whole number, or leave blank to use global default.')
        return
      }
      await save(n)
    }
  }

  async function handleReset() {
    setValue('')
    await save(null)
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2 min-w-[90px]">
        <button
          type="button"
          onClick={() => {
            setValue(product.low_stock_threshold !== null ? String(product.low_stock_threshold) : '')
            setError(null)
            setEditing(true)
          }}
          className="text-xs text-gray-700 hover:text-gray-900 underline-offset-2 hover:underline"
          title="Click to edit threshold"
        >
          {product.low_stock_threshold !== null ? product.low_stock_threshold : '—'}
        </button>
        {product.low_stock_threshold !== null && (
          <button
            type="button"
            onClick={handleReset}
            disabled={saving}
            className="text-[10px] text-gray-400 hover:text-red-500 transition-colors disabled:opacity-50"
            title="Reset to global default"
          >
            Reset
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1 min-w-[120px]" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => { setValue(e.target.value); setError(null) }}
          placeholder="Global"
          className="w-16 rounded border border-gray-300 px-1.5 py-0.5 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded bg-gray-900 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {saving ? '…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="text-[10px] text-gray-400 hover:text-gray-600"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-[10px] text-red-600">{error}</p>}
    </div>
  )
}
