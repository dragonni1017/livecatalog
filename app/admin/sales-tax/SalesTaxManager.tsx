'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { readApiError, TRANSPORT_ERROR } from '@/lib/admin-fetch'
import { MAX_NOTE_CHARS, MAX_RATE_PERCENT, type SalesTaxState } from '@/lib/sales-tax'
import { US_STATE_NAMES, US_STATES } from '@/lib/us-states'

interface Form {
  editing: boolean
  state: string
  rate_percent: string
  is_active: boolean
  note: string
}

const EMPTY: Form = { editing: false, state: '', rate_percent: '', is_active: true, note: '' }

export default function SalesTaxManager({ initial }: { initial: SalesTaxState[] }) {
  const router = useRouter()
  const [form, setForm] = useState<Form | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const configured = new Set(initial.map((r) => r.state))

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/admin/api/sales-tax', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: form.state, rate_percent: form.rate_percent, is_active: form.is_active, note: form.note }),
      })
      const err = await readApiError(res, 'Could not save the rate.')
      if (err) return setError(err)
      setForm(null)
      router.refresh()
    } catch {
      setError(TRANSPORT_ERROR)
    } finally {
      setBusy(false)
    }
  }

  async function remove(r: SalesTaxState) {
    if (!window.confirm(`Remove ${US_STATE_NAMES[r.state] ?? r.state}? Tax there will show as not collected.`)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/admin/api/sales-tax?state=${r.state}`, { method: 'DELETE' })
      const err = await readApiError(res, 'Could not remove the rate.')
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
          <p className="px-4 py-8 text-center text-sm text-gray-500">
            No states set up. Until one is, no buyer sees any sales tax.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">State</th>
                <th className="px-4 py-3 text-right">Rate</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Note</th>
                <th className="px-4 py-3">Last changed</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {initial.map((r) => (
                <tr key={r.state} className="align-top">
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-900">{US_STATE_NAMES[r.state] ?? r.state}</span>{' '}
                    <span className="font-mono text-xs text-gray-500">{r.state}</span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{Number(r.rate_percent)}%</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${r.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                      {r.is_active ? 'Collected' : 'Off'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{r.note ?? ''}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {new Date(r.updated_at).toLocaleDateString('en-US')}
                    {r.updated_by ? <div>{r.updated_by}</div> : null}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setForm({ editing: true, state: r.state, rate_percent: String(Number(r.rate_percent)), is_active: r.is_active, note: r.note ?? '' })}
                      className="text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => remove(r)}
                      className="ml-3 text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {form ? (
        <form onSubmit={save} className="space-y-4 rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-base font-semibold text-gray-900">
            {form.editing ? `Edit ${US_STATE_NAMES[form.state] ?? form.state}` : 'Add a state'}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">State</span>
              <select
                required
                disabled={form.editing}
                value={form.state}
                onChange={(e) => set('state', e.target.value)}
                className={input}
              >
                <option value="">Choose…</option>
                {US_STATES.filter((s) => form.editing || !configured.has(s)).map((s) => (
                  <option key={s} value={s}>{US_STATE_NAMES[s]} ({s})</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-gray-700">Estimated rate (%)</span>
              <input
                required
                inputMode="decimal"
                pattern="\d{1,2}(\.\d{1,4})?"
                title={`A percent from 0 to ${MAX_RATE_PERCENT}, up to 4 decimals, e.g. 7.25`}
                value={form.rate_percent}
                onChange={(e) => set('rate_percent', e.target.value)}
                placeholder="7.25"
                className={input}
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">Note (optional)</span>
            <input
              maxLength={MAX_NOTE_CHARS}
              value={form.note}
              onChange={(e) => set('note', e.target.value)}
              placeholder="e.g. state base rate, no district tax"
              className={input}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
            Collect tax for this state
          </label>
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setForm(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setForm(EMPTY)}
          className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
        >
          Add a state
        </button>
      )}
    </div>
  )
}
