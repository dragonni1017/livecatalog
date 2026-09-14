'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { readApiError, TRANSPORT_ERROR } from '@/lib/admin-fetch'
import { binTypeIsUsable, implausibleBinType, parseMeasurementInput } from '@/lib/measurements'

export interface BinTypeRow {
  id: string
  name: string
  length_in: number | null
  width_in: number | null
  height_in: number | null
  max_weight_lb: number | null
  notes: string | null
  binCount: number
}

export interface BinRow {
  id: string
  code: string
  status: string
  bin_type_id: string | null
  erply_warehouse_id: number | null
}

type Draft = { name: string; length: string; width: string; height: string; weight: string }

const asInput = (v: number | null) => (v == null ? '' : String(v))

const draftFor = (t: BinTypeRow): Draft => ({
  name: t.name,
  length: asInput(t.length_in),
  width: asInput(t.width_in),
  height: asInput(t.height_in),
  weight: asInput(t.max_weight_lb),
})

const EMPTY_DRAFT: Draft = { name: '', length: '', width: '', height: '', weight: '' }

const INPUT = 'rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 tabular-nums focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500'

// Turns a draft into the API's field names, or an error for the first
// unusable value. Same parser and same rule the route applies, so a typo is
// caught without a round trip -- the server re-checks regardless.
function toPayload(draft: Draft): { fields?: Record<string, number | null>; error?: string } {
  const fields: Record<string, number | null> = {}
  for (const [key, field] of [
    ['length', 'length_in'],
    ['width', 'width_in'],
    ['height', 'height_in'],
    ['weight', 'max_weight_lb'],
  ] as const) {
    const { value, error } = parseMeasurementInput(draft[key])
    if (error) return { error: `${key}: ${error}` }
    fields[field] = value
  }
  const problem = implausibleBinType(fields)
  if (problem) return { error: `That can't be a real bin: ${problem}` }
  return { fields }
}

export default function BinCapacityManager({ binTypes, bins }: { binTypes: BinTypeRow[]; bins: BinRow[] }) {
  const router = useRouter()

  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(binTypes.map((t) => [t.id, draftFor(t)])),
  )
  const [newDraft, setNewDraft] = useState<Draft>(EMPTY_DRAFT)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const [codeFilter, setCodeFilter] = useState('')
  const [assignFilter, setAssignFilter] = useState<'all' | 'unassigned' | 'assigned'>('unassigned')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [assignTo, setAssignTo] = useState<string>('')
  const [assigning, setAssigning] = useState(false)

  const setError = (key: string, message: string | null) =>
    setErrors((prev) => {
      if (message === null) {
        if (!prev[key]) return prev
        const next = { ...prev }
        delete next[key]
        return next
      }
      return { ...prev, [key]: message }
    })

  const visibleBins = useMemo(() => {
    const term = codeFilter.trim().toLowerCase()
    return bins.filter((b) => {
      if (assignFilter === 'unassigned' && b.bin_type_id !== null) return false
      if (assignFilter === 'assigned' && b.bin_type_id === null) return false
      if (term && !b.code.toLowerCase().includes(term)) return false
      return true
    })
  }, [bins, codeFilter, assignFilter])

  const typeNameById = useMemo(
    () => new Map(binTypes.map((t) => [t.id, t.name])),
    [binTypes],
  )

  async function saveType(t: BinTypeRow) {
    const draft = drafts[t.id] ?? draftFor(t)
    if (!draft.name.trim()) {
      setError(t.id, 'Name is required.')
      return
    }
    const { fields, error } = toPayload(draft)
    if (error) {
      setError(t.id, error)
      return
    }
    setBusyId(t.id)
    setError(t.id, null)
    try {
      const res = await fetch('/admin/api/bins', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_type', id: t.id, name: draft.name.trim(), ...fields }),
      })
      const err = await readApiError(res, 'Save failed.')
      if (err) {
        setError(t.id, err)
        return
      }
      router.refresh()
    } catch {
      setError(t.id, TRANSPORT_ERROR)
    } finally {
      setBusyId(null)
    }
  }

  async function createType() {
    if (!newDraft.name.trim()) {
      setError('new', 'Give the bin type a name.')
      return
    }
    const { fields, error } = toPayload(newDraft)
    if (error) {
      setError('new', error)
      return
    }
    setBusyId('new')
    setError('new', null)
    try {
      const res = await fetch('/admin/api/bins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_type', name: newDraft.name.trim(), ...fields }),
      })
      const err = await readApiError(res, 'Could not create the bin type.')
      if (err) {
        setError('new', err)
        return
      }
      setNewDraft(EMPTY_DRAFT)
      router.refresh()
    } catch {
      setError('new', TRANSPORT_ERROR)
    } finally {
      setBusyId(null)
    }
  }

  async function deleteType(t: BinTypeRow) {
    const message = t.binCount > 0
      ? `Delete "${t.name}"? ${t.binCount} bin${t.binCount === 1 ? '' : 's'} will go back to unknown capacity. The bins themselves stay.`
      : `Delete "${t.name}"?`
    if (!window.confirm(message)) return

    setBusyId(t.id)
    try {
      const res = await fetch(`/admin/api/bins?type_id=${encodeURIComponent(t.id)}`, { method: 'DELETE' })
      const err = await readApiError(res, 'Delete failed.')
      if (err) {
        setError(t.id, err)
        return
      }
      router.refresh()
    } catch {
      setError(t.id, TRANSPORT_ERROR)
    } finally {
      setBusyId(null)
    }
  }

  async function applyAssignment() {
    if (selected.size === 0) return
    setAssigning(true)
    setError('assign', null)
    try {
      const res = await fetch('/admin/api/bins', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'assign_type',
          bin_ids: [...selected],
          // '' is the "clear assignment" option in the dropdown.
          bin_type_id: assignTo === '' ? null : assignTo,
        }),
      })
      const err = await readApiError(res, 'Assignment failed.')
      if (err) {
        setError('assign', err)
        return
      }
      setSelected(new Set())
      router.refresh()
    } catch {
      setError('assign', TRANSPORT_ERROR)
    } finally {
      setAssigning(false)
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allVisibleSelected = visibleBins.length > 0 && visibleBins.every((b) => selected.has(b.id))

  return (
    <div className="space-y-8">
      {/* ── Bin types ───────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">Bin types</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            The usable interior of a bin and what it can safely hold. A type with no dimensions can&apos;t be used
            for capacity.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-5 py-3 text-left font-semibold text-gray-700">Name</th>
                <th className="px-2 py-3 text-center font-semibold text-gray-700">L (in)</th>
                <th className="px-2 py-3 text-center font-semibold text-gray-700">W (in)</th>
                <th className="px-2 py-3 text-center font-semibold text-gray-700">H (in)</th>
                <th className="px-2 py-3 text-center font-semibold text-gray-700">Max lb</th>
                <th className="px-3 py-3 text-right font-semibold text-gray-700">Bins</th>
                <th className="px-5 py-3 text-right font-semibold text-gray-700"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {binTypes.map((t) => {
                const draft = drafts[t.id] ?? draftFor(t)
                const busy = busyId === t.id
                const usable = binTypeIsUsable(t)
                return (
                  <tr key={t.id}>
                    <td className="px-5 py-3">
                      <input
                        value={draft.name}
                        onChange={(e) => setDrafts((p) => ({ ...p, [t.id]: { ...draft, name: e.target.value } }))}
                        disabled={busy}
                        className={`${INPUT} w-48`}
                      />
                      {!usable && (
                        <div className="mt-1 text-xs text-amber-700">Needs all three dimensions to be usable</div>
                      )}
                      {errors[t.id] && <div className="mt-1 text-xs font-medium text-red-600">{errors[t.id]}</div>}
                    </td>
                    {(['length', 'width', 'height', 'weight'] as const).map((field) => (
                      <td key={field} className="px-2 py-3 text-center">
                        <input
                          inputMode="decimal"
                          value={draft[field]}
                          onChange={(e) => setDrafts((p) => ({ ...p, [t.id]: { ...draft, [field]: e.target.value } }))}
                          disabled={busy}
                          aria-label={`${t.name} ${field}`}
                          className={`${INPUT} w-20`}
                        />
                      </td>
                    ))}
                    <td className="px-3 py-3 text-right tabular-nums text-gray-600">{t.binCount.toLocaleString()}</td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => saveType(t)}
                          disabled={busy}
                          className="rounded-md bg-gray-900 px-3 py-1 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
                        >
                          {busy ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          onClick={() => deleteType(t)}
                          disabled={busy}
                          className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}

              {/* New type row */}
              <tr className="bg-gray-50/60">
                <td className="px-5 py-3">
                  <input
                    value={newDraft.name}
                    onChange={(e) => setNewDraft({ ...newDraft, name: e.target.value })}
                    placeholder="e.g. Standard shelf"
                    disabled={busyId === 'new'}
                    className={`${INPUT} w-48`}
                  />
                  {errors.new && <div className="mt-1 text-xs font-medium text-red-600">{errors.new}</div>}
                </td>
                {(['length', 'width', 'height', 'weight'] as const).map((field) => (
                  <td key={field} className="px-2 py-3 text-center">
                    <input
                      inputMode="decimal"
                      value={newDraft[field]}
                      onChange={(e) => setNewDraft({ ...newDraft, [field]: e.target.value })}
                      disabled={busyId === 'new'}
                      aria-label={`new bin type ${field}`}
                      className={`${INPUT} w-20`}
                    />
                  </td>
                ))}
                <td />
                <td className="px-5 py-3 text-right">
                  <button
                    onClick={createType}
                    disabled={busyId === 'new'}
                    className="rounded-md bg-gray-900 px-3 py-1 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
                  >
                    {busyId === 'new' ? 'Adding…' : 'Add type'}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Bins ────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 className="text-base font-semibold text-gray-900">Bins</h2>
          <p className="mt-0.5 text-sm text-gray-500">
            Mirrored from Erply. Assign each to a type rather than measuring all of them — codes are
            aisle-rack-level, so filtering by prefix (e.g. <code>01-</code>) selects a whole aisle at once.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 px-5 py-3">
          <input
            value={codeFilter}
            onChange={(e) => setCodeFilter(e.target.value)}
            placeholder="Filter by code…"
            className={`${INPUT} w-40`}
          />
          <select
            value={assignFilter}
            onChange={(e) => setAssignFilter(e.target.value as typeof assignFilter)}
            className={INPUT}
          >
            <option value="unassigned">No type yet</option>
            <option value="assigned">Has a type</option>
            <option value="all">All bins</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={() =>
                setSelected(allVisibleSelected ? new Set() : new Set(visibleBins.map((b) => b.id)))
              }
              className="h-3.5 w-3.5 rounded border-gray-300 text-red-600 focus:ring-red-500"
            />
            Select all {visibleBins.length.toLocaleString()} shown
          </label>

          <div className="ml-auto flex items-center gap-2">
            <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className={INPUT}>
              <option value="">— clear type —</option>
              {binTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              onClick={applyAssignment}
              disabled={selected.size === 0 || assigning}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-40"
            >
              {assigning ? 'Applying…' : `Apply to ${selected.size.toLocaleString()} selected`}
            </button>
          </div>
        </div>

        {errors.assign && (
          <div className="border-b border-gray-200 px-5 py-2 text-xs font-medium text-red-600">{errors.assign}</div>
        )}

        {visibleBins.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-gray-500">No bins match this filter.</p>
        ) : (
          <ul className="max-h-[28rem] divide-y divide-gray-100 overflow-y-auto">
            {visibleBins.map((b) => (
              <li key={b.id} className="flex items-center gap-3 px-5 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(b.id)}
                  onChange={() => toggle(b.id)}
                  className="h-3.5 w-3.5 rounded border-gray-300 text-red-600 focus:ring-red-500"
                />
                <span className="font-mono text-gray-900">{b.code}</span>
                {b.status !== 'ACTIVE' && <span className="text-xs text-gray-400">{b.status.toLowerCase()}</span>}
                <span className="ml-auto text-xs text-gray-500">
                  {b.bin_type_id ? (typeNameById.get(b.bin_type_id) ?? 'unknown type') : '—'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
