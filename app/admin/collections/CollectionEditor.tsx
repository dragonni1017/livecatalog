'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { readApiError, TRANSPORT_ERROR } from '@/lib/admin-fetch'
import { slugify, type Collection } from '@/lib/collections'

type Fields = Pick<Collection, 'name' | 'slug' | 'description' | 'is_active' | 'starts_on' | 'ends_on' | 'display_order'>

const EMPTY: Fields = { name: '', slug: '', description: '', is_active: true, starts_on: '', ends_on: '', display_order: 0 }

export function CollectionDetailsForm({ initial }: { initial?: Collection }) {
  const router = useRouter()
  const [f, setF] = useState<Fields>(initial ? { ...initial, description: initial.description ?? '', starts_on: initial.starts_on ?? '', ends_on: initial.ends_on ?? '' } : EMPTY)
  const [slugTouched, setSlugTouched] = useState(!!initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const set = <K extends keyof Fields>(k: K, v: Fields[K]) => {
    setSaved(false)
    setF((prev) => ({ ...prev, [k]: v, ...(k === 'name' && !slugTouched ? { slug: slugify(String(v)) } : {}) }))
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/admin/api/collections', {
        method: initial ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(initial ? { id: initial.id } : {}), ...f }),
      })
      const err = await readApiError(res, 'Could not save the collection.')
      if (err) return setError(err)
      const { collection } = (await res.json()) as { collection: Collection }
      if (initial) {
        setSaved(true)
        router.refresh()
      } else {
        router.push(`/admin/collections/${collection.id}`)
      }
    } catch {
      setError(TRANSPORT_ERROR)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!initial || !window.confirm(`Delete "${initial.name}"? Its product list is deleted too. Products themselves aren't affected.`)) return
    setBusy(true)
    try {
      const res = await fetch(`/admin/api/collections?id=${initial.id}`, { method: 'DELETE' })
      const err = await readApiError(res, 'Could not delete the collection.')
      if (err) return setError(err)
      router.push('/admin/collections')
    } catch {
      setError(TRANSPORT_ERROR)
    } finally {
      setBusy(false)
    }
  }

  const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm'
  return (
    <form onSubmit={save} className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-gray-600">
          Name *
          <input value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={80} required className={`mt-1 ${input}`} placeholder="Valentine's Day" />
        </label>
        <label className="block text-xs font-medium text-gray-600">
          URL name
          <div className="mt-1 flex items-center gap-1 text-sm text-gray-400">
            /collections/
            <input
              value={f.slug}
              onChange={(e) => {
                setSlugTouched(true)
                set('slug', e.target.value.toLowerCase())
              }}
              maxLength={60}
              className={input}
            />
          </div>
        </label>
      </div>
      <label className="block text-xs font-medium text-gray-600">
        Description (shown under the title)
        <textarea value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} maxLength={500} rows={2} className={`mt-1 ${input}`} />
      </label>
      <div className="flex flex-wrap items-end gap-4">
        <label className="block text-xs font-medium text-gray-600">
          Starts (optional)
          <input type="date" value={f.starts_on ?? ''} onChange={(e) => set('starts_on', e.target.value)} className={`mt-1 ${input}`} />
        </label>
        <label className="block text-xs font-medium text-gray-600">
          Ends (optional, inclusive)
          <input type="date" value={f.ends_on ?? ''} onChange={(e) => set('ends_on', e.target.value)} className={`mt-1 ${input}`} />
        </label>
        <label className="block text-xs font-medium text-gray-600">
          Order in menu
          <input type="number" value={f.display_order} onChange={(e) => set('display_order', Number(e.target.value))} className={`mt-1 w-24 ${input}`} />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-gray-700">
          <input type="checkbox" checked={f.is_active} onChange={(e) => set('is_active', e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-red-600" />
          Active
        </label>
      </div>
      <p className="text-xs text-gray-400">Dates are Pacific time. A collection shows in the catalog menu only while it&apos;s active and inside its dates.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
          {busy ? 'Saving…' : initial ? 'Save details' : 'Create collection'}
        </button>
        {saved && <span className="text-sm text-green-700">Saved</span>}
        {initial && (
          <button type="button" onClick={remove} disabled={busy} className="ml-auto text-sm text-gray-500 hover:text-red-700 disabled:opacity-50">
            Delete collection
          </button>
        )}
      </div>
    </form>
  )
}

export function CollectionProductsForm({ id, initialSkus }: { id: string; initialSkus: string[] }) {
  const router = useRouter()
  const [skus, setSkus] = useState(initialSkus.join('\n'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ saved: string[]; notFound: string[]; hidden: string[] } | null>(null)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/admin/api/collections/${id}/products`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skus }),
      })
      const err = await readApiError(res, 'Could not save the products.')
      if (err) return setError(err)
      const r = (await res.json()) as { saved: string[]; notFound: string[]; hidden: string[] }
      setResult(r)
      setSkus(r.saved.join('\n'))
      router.refresh()
    } catch {
      setError(TRANSPORT_ERROR)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <label className="block text-xs font-medium text-gray-600">
        SKUs, one per line (or comma-separated), in the order to show them. Exact SKUs; case matters.
        <textarea value={skus} onChange={(e) => setSkus(e.target.value)} rows={12} className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm" />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {result && (
        <div className="text-sm">
          <p className="text-green-700">Saved {result.saved.length} product{result.saved.length === 1 ? '' : 's'}.</p>
          {result.notFound.length > 0 && <p className="text-amber-700">Not found, skipped ({result.notFound.length}): {result.notFound.join(', ')}</p>}
          {result.hidden.length > 0 && <p className="text-gray-500">Hidden right now, so not shown on the page ({result.hidden.length}): {result.hidden.join(', ')}</p>}
        </div>
      )}
      <button type="submit" disabled={busy} className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50">
        {busy ? 'Saving…' : 'Save products'}
      </button>
    </form>
  )
}
