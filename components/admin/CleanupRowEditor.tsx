'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { readApiError, TRANSPORT_ERROR } from '@/lib/admin-fetch'

// One /admin/cleanup row's category or description fix, saved through the
// existing PATCH /admin/api/products (the same write the products edit modal
// uses). Catalog-only: neither field is pushed to Erply, and the Erply sync
// only sets either on insert, so the edit survives it.
//
// The category picker sends category_ids, which REPLACES a product's whole
// category set. That is safe here only because this editor is shown just for
// rows with no category at all -- there is nothing to lose. Products that
// already have categories are edited from /admin/products.

interface Props {
  id: string
  mode: 'category' | 'description'
  description: string
  categories: { id: string; name: string }[]
}

export default function CleanupRowEditor({ id, mode, description, categories }: Props) {
  const router = useRouter()
  const [categoryId, setCategoryId] = useState('')
  const [text, setText] = useState(description)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const canSave = mode === 'category' ? Boolean(categoryId) : Boolean(text.trim())

  async function save() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/admin/api/products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'category' ? { id, category_ids: [categoryId] } : { id, description: text }),
      })
      const err = await readApiError(res, 'Save failed.')
      if (err) {
        setError(err)
        return
      }
      setSaved(true)
      // The row no longer qualifies, so the refreshed page drops it.
      router.refresh()
    } catch {
      setError(TRANSPORT_ERROR)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex min-w-[18rem] flex-col gap-2">
      {mode === 'category' ? (
        <select
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value)
            setSaved(false)
          }}
          className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900"
        >
          <option value="">Choose a category…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      ) : (
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            setSaved(false)
          }}
          rows={3}
          placeholder="Write a description…"
          className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900"
        />
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!canSave || saving}
          className="rounded-lg bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700 disabled:opacity-40 transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saved && !error && <span className="text-xs text-green-700">Saved</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  )
}
