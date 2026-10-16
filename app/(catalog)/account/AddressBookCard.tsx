'use client'

import { useState } from 'react'
import type { AddressInput, CustomerAddress } from '@/lib/customer-addresses'
import StateSelect from '@/components/catalog/StateSelect'

const EMPTY: AddressInput = { label: '', address1: '', address2: '', city: '', state: '', zip: '' }

async function errorFrom(res: Response, fallback: string): Promise<string> {
  try {
    const body = await res.json()
    return typeof body?.error === 'string' ? body.error : fallback
  } catch {
    return fallback
  }
}

export default function AddressBookCard({ initial }: { initial: CustomerAddress[] }) {
  const [addresses, setAddresses] = useState(initial)
  // null = closed, 'new' = adding, otherwise the id being edited
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState<AddressInput>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(method: string, body?: unknown, query = '') {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/account/addresses${query}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) {
        setError(await errorFrom(res, 'Something went wrong. Please try again.'))
        return false
      }
      const { addresses: next } = (await res.json()) as { addresses: CustomerAddress[] }
      setAddresses(next)
      return true
    } catch {
      setError('Network error. Please try again.')
      return false
    } finally {
      setBusy(false)
    }
  }

  function openForm(a?: CustomerAddress) {
    setError(null)
    setEditing(a ? a.id : 'new')
    setForm(a ? { label: a.label ?? '', address1: a.address1, address2: a.address2 ?? '', city: a.city, state: a.state, zip: a.zip } : EMPTY)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    const ok = editing === 'new' ? await send('POST', form) : await send('PATCH', { id: editing, ...form })
    if (ok) setEditing(null)
  }

  const field = (key: keyof AddressInput, label: string, opts: { required?: boolean; max: number; className?: string }) => (
    <div className={opts.className}>
      <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor={`addr-${key}`}>
        {label}
        {opts.required ? ' *' : ''}
      </label>
      <input
        id={`addr-${key}`}
        value={form[key] ?? ''}
        maxLength={opts.max}
        required={opts.required}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
    </div>
  )

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-gray-500">Ship-to Addresses</h2>
      <p className="mb-4 text-sm text-gray-500">Saved addresses appear in the cart so you can pick one when you order.</p>

      {addresses.length > 0 && (
        <ul className="mb-4 divide-y divide-gray-100 rounded-lg border border-gray-100">
          {addresses.map((a) => (
            <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 text-sm">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900">{a.label || a.address1}</span>
                  {a.is_default && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">Default</span>
                  )}
                </div>
                <p className="text-gray-500">
                  {a.label ? `${a.address1}, ` : ''}
                  {a.address2 ? `${a.address2}, ` : ''}
                  {a.city}, {a.state} {a.zip}
                </p>
              </div>
              <div className="flex shrink-0 gap-3 text-xs font-medium">
                {!a.is_default && (
                  <button type="button" disabled={busy} onClick={() => send('PATCH', { id: a.id, setDefault: true })} className="text-gray-600 hover:text-gray-900 disabled:opacity-50">
                    Make default
                  </button>
                )}
                <button type="button" disabled={busy} onClick={() => openForm(a)} className="text-red-600 hover:text-red-700 disabled:opacity-50">
                  Edit
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => send('DELETE', undefined, `?id=${encodeURIComponent(a.id)}`)}
                  className="text-gray-500 hover:text-red-700 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <form onSubmit={save} className="space-y-3">
          {field('label', 'Label (e.g. "Main St store")', { max: 60 })}
          {field('address1', 'Street', { required: true, max: 200 })}
          {field('address2', 'Suite / unit', { max: 200 })}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {field('city', 'City', { required: true, max: 100 })}
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600" htmlFor="addr-state">
                State *
              </label>
              <StateSelect
                id="addr-state"
                value={form.state ?? ''}
                onChange={(v) => setForm({ ...form, state: v })}
                required
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
              />
            </div>
            {field('zip', 'ZIP', { required: true, max: 20 })}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
              {busy ? 'Saving…' : 'Save address'}
            </button>
            <button type="button" onClick={() => setEditing(null)} className="text-sm text-gray-500 hover:text-gray-700">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
          <button
            type="button"
            onClick={() => openForm()}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-gray-400 hover:text-gray-900"
          >
            + Add an address
          </button>
        </>
      )}
    </div>
  )
}
