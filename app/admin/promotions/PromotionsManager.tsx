'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { readApiError, TRANSPORT_ERROR } from '@/lib/admin-fetch'
import type { Promotion } from '@/lib/promotions'

type Row = Promotion & { statusLabel: string; live: boolean; savedCents: number }
type Named = { id: string; name: string }

interface Form {
  id?: string
  code: string
  name: string
  percent_off: string
  is_active: boolean
  starts_on: string
  ends_on: string
  scope_kind: 'all' | 'collection' | 'category'
  scope_collection_id: string
  scope_category_id: string
  min_subtotal: string
  max_uses: string
}

const EMPTY: Form = {
  code: '', name: '', percent_off: '10', is_active: true, starts_on: '', ends_on: '',
  scope_kind: 'all', scope_collection_id: '', scope_category_id: '', min_subtotal: '', max_uses: '',
}

function toForm(p: Row): Form {
  return {
    id: p.id, code: p.code, name: p.name, percent_off: String(Number(p.percent_off)), is_active: p.is_active,
    starts_on: p.starts_on ?? '', ends_on: p.ends_on ?? '', scope_kind: p.scope_kind,
    scope_collection_id: p.scope_collection_id ?? '', scope_category_id: p.scope_category_id ?? '',
    min_subtotal: p.min_subtotal_cents != null ? String(p.min_subtotal_cents / 100) : '',
    max_uses: p.max_uses != null ? String(p.max_uses) : '',
  }
}

const money = (cents: number) => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function PromotionsManager({ initial, collections, categories }: { initial: Row[]; collections: Named[]; categories: Named[] }) {
  const router = useRouter()
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scopeName = (p: Row) =>
    p.scope_kind === 'collection'
      ? `Collection: ${collections.find((c) => c.id === p.scope_collection_id)?.name ?? '(deleted)'}`
      : p.scope_kind === 'category'
        ? `Category: ${categories.find((c) => c.id === p.scope_category_id)?.name ?? '(deleted)'}`
        : 'Everything'

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/admin/api/promotions', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const err = await readApiError(res, 'Could not save the promotion.')
      if (err) return setError(err)
      setForm(null)
      router.refresh()
    } catch {
      setError(TRANSPORT_ERROR)
    } finally {
      setBusy(false)
    }
  }

  async function remove(p: Row) {
    if (!window.confirm(`Delete ${p.code}? This can't be undone.`)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/admin/api/promotions?id=${p.id}`, { method: 'DELETE' })
      const err = await readApiError(res, 'Could not delete the promotion.')
      if (err) return setError(err)
      router.refresh()
    } catch {
      setError(TRANSPORT_ERROR)
    } finally {
      setBusy(false)
    }
  }

  const input = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm'
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => (f ? { ...f, [k]: v } : f))

  return (
    <div>
      {error && <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

      <div className="mb-6 overflow-x-auto rounded-xl border border-gray-200 bg-white">
        {initial.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-gray-500">No promotions yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Off</th>
                <th className="px-4 py-3">Applies to</th>
                <th className="px-4 py-3">Limits</th>
                <th className="px-4 py-3 text-right">Used</th>
                <th className="px-4 py-3 text-right">Saved buyers</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {initial.map((p) => (
                <tr key={p.id} className="align-top">
                  <td className="px-4 py-3">
                    <div className="font-mono font-semibold text-gray-900">{p.code}</div>
                    <div className="text-xs text-gray-500">{p.name}</div>
                  </td>
                  <td className="px-4 py-3">{Number(p.percent_off)}%</td>
                  <td className="px-4 py-3 text-gray-700">{scopeName(p)}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {p.starts_on || p.ends_on ? <div>{p.starts_on ?? '…'} to {p.ends_on ?? '…'}</div> : null}
                    {p.min_subtotal_cents != null && <div>Min {money(p.min_subtotal_cents)}</div>}
                    {p.max_uses != null && <div>Cap {p.max_uses}</div>}
                    {!p.starts_on && !p.ends_on && p.min_subtotal_cents == null && p.max_uses == null && '—'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {p.times_used}
                    {p.max_uses != null ? ` / ${p.max_uses}` : ''}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(p.savedCents)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${p.live ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                      {p.statusLabel}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-xs">
                    <button type="button" onClick={() => setForm(toForm(p))} className="text-red-600 hover:text-red-700">Edit</button>
                    {p.times_used === 0 && (
                      <button type="button" disabled={busy} onClick={() => remove(p)} className="ml-3 text-gray-500 hover:text-red-700 disabled:opacity-50">Delete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {form ? (
        <form onSubmit={save} className="space-y-3 rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{form.id ? `Edit ${form.code}` : 'New promotion'}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block text-xs font-medium text-gray-600">
              Code *
              <input value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} maxLength={32} required className={`mt-1 font-mono uppercase ${input}`} placeholder="HOLIDAY10" />
            </label>
            <label className="block text-xs font-medium text-gray-600 sm:col-span-2">
              Name (for your records) *
              <input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={80} required className={`mt-1 ${input}`} placeholder="Holiday 2026, 10% off" />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="block text-xs font-medium text-gray-600">
              Percent off *
              <input type="number" step="0.01" min="0.01" max="90" value={form.percent_off} onChange={(e) => set('percent_off', e.target.value)} required className={`mt-1 ${input}`} />
            </label>
            <label className="block text-xs font-medium text-gray-600">
              Starts
              <input type="date" value={form.starts_on} onChange={(e) => set('starts_on', e.target.value)} className={`mt-1 ${input}`} />
            </label>
            <label className="block text-xs font-medium text-gray-600">
              Ends (inclusive)
              <input type="date" value={form.ends_on} onChange={(e) => set('ends_on', e.target.value)} className={`mt-1 ${input}`} />
            </label>
            <label className="flex items-center gap-2 pt-5 text-sm text-gray-700">
              <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-red-600" />
              Active
            </label>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="block text-xs font-medium text-gray-600">
              Applies to
              <select value={form.scope_kind} onChange={(e) => set('scope_kind', e.target.value as Form['scope_kind'])} className={`mt-1 bg-white ${input}`}>
                <option value="all">Everything</option>
                <option value="collection" disabled={collections.length === 0}>One collection</option>
                <option value="category">One category</option>
              </select>
            </label>
            {form.scope_kind === 'collection' && (
              <label className="block text-xs font-medium text-gray-600 sm:col-span-2">
                Collection
                <select value={form.scope_collection_id} onChange={(e) => set('scope_collection_id', e.target.value)} required className={`mt-1 bg-white ${input}`}>
                  <option value="">Choose…</option>
                  {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            )}
            {form.scope_kind === 'category' && (
              <label className="block text-xs font-medium text-gray-600 sm:col-span-2">
                Category
                <select value={form.scope_category_id} onChange={(e) => set('scope_category_id', e.target.value)} required className={`mt-1 bg-white ${input}`}>
                  <option value="">Choose…</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="block text-xs font-medium text-gray-600">
              Minimum order ($)
              <input type="number" step="0.01" min="0" value={form.min_subtotal} onChange={(e) => set('min_subtotal', e.target.value)} className={`mt-1 ${input}`} placeholder="none" />
            </label>
            <label className="block text-xs font-medium text-gray-600">
              Usage cap (orders)
              <input type="number" step="1" min="1" value={form.max_uses} onChange={(e) => set('max_uses', e.target.value)} className={`mt-1 ${input}`} placeholder="unlimited" />
            </label>
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50">
              {busy ? 'Saving…' : form.id ? 'Save changes' : 'Create promotion'}
            </button>
            <button type="button" onClick={() => setForm(null)} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setForm(EMPTY)} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700">
          + New promotion
        </button>
      )}
    </div>
  )
}
