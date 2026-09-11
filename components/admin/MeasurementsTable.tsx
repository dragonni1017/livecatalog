'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { readApiError, TRANSPORT_ERROR } from '@/lib/admin-fetch'
import { implausibleCaseMeasurement, parseMeasurementInput } from '@/lib/measurements'

export interface MeasurementTableRow {
  id: string
  sku: string
  name: string
  packSpec: string
  unitsPerCase: number | null
  stockQty: number
  manuallyHidden: boolean
  caseLengthIn: number | null
  caseWidthIn: number | null
  caseHeightIn: number | null
  caseWeightLb: number | null
  source: string | null
  updatedAt: string | null
  updatedBy: string | null
  problem: string | null
}

type Draft = { length: string; width: string; height: string; weight: string }

const asInput = (v: number | null) => (v == null ? '' : String(v))

function draftFor(row: MeasurementTableRow): Draft {
  return {
    length: asInput(row.caseLengthIn),
    width: asInput(row.caseWidthIn),
    height: asInput(row.caseHeightIn),
    weight: asInput(row.caseWeightLb),
  }
}

const CELL_CLASS =
  'w-20 rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 tabular-nums focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500'

export default function MeasurementsTable({ rows }: { rows: MeasurementTableRow[] }) {
  const router = useRouter()
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, draftFor(r)])),
  )
  const [savingId, setSavingId] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState<Record<string, boolean>>({})

  function edit(row: MeasurementTableRow, field: keyof Draft, value: string) {
    setDrafts((prev) => ({ ...prev, [row.id]: { ...(prev[row.id] ?? draftFor(row)), [field]: value } }))
    // Clear a stale "saved" tick or error as soon as the row is touched again.
    setSaved((prev) => (prev[row.id] ? { ...prev, [row.id]: false } : prev))
    setErrors((prev) => {
      if (!prev[row.id]) return prev
      const next = { ...prev }
      delete next[row.id]
      return next
    })
  }

  function isDirty(row: MeasurementTableRow) {
    const draft = drafts[row.id] ?? draftFor(row)
    const original = draftFor(row)
    return (['length', 'width', 'height', 'weight'] as const).some((k) => draft[k].trim() !== original[k])
  }

  async function save(row: MeasurementTableRow) {
    const draft = drafts[row.id] ?? draftFor(row)

    // Validated client-side first with the same helpers the route uses, so a
    // typo is caught without a round trip. The server re-checks regardless --
    // this is convenience, not the guard.
    const parsed: Record<string, number | null> = {}
    for (const [key, field] of [
      ['length', 'case_length_in'],
      ['width', 'case_width_in'],
      ['height', 'case_height_in'],
      ['weight', 'case_weight_lb'],
    ] as const) {
      const { value, error } = parseMeasurementInput(draft[key])
      if (error) {
        setErrors((prev) => ({ ...prev, [row.id]: `${key}: ${error}` }))
        return
      }
      parsed[field] = value
    }

    const problem = implausibleCaseMeasurement(parsed)
    if (problem) {
      setErrors((prev) => ({ ...prev, [row.id]: `That can't be a real carton: ${problem}` }))
      return
    }

    setSavingId(row.id)
    setErrors((prev) => {
      const next = { ...prev }
      delete next[row.id]
      return next
    })
    try {
      const res = await fetch('/admin/api/products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, ...parsed }),
      })
      const err = await readApiError(res, 'Save failed.')
      if (err) {
        setErrors((prev) => ({ ...prev, [row.id]: err }))
        return
      }
      setSaved((prev) => ({ ...prev, [row.id]: true }))
      // Refresh so the row re-buckets (a measured product leaves the "needs
      // measuring" tab) and the counts update.
      router.refresh()
    } catch {
      setErrors((prev) => ({ ...prev, [row.id]: TRANSPORT_ERROR }))
    } finally {
      setSavingId(null)
    }
  }

  function clear(row: MeasurementTableRow) {
    setDrafts((prev) => ({ ...prev, [row.id]: { length: '', width: '', height: '', weight: '' } }))
    setSaved((prev) => ({ ...prev, [row.id]: false }))
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-10 text-center">
        <p className="text-sm text-gray-500">Nothing here — no products match this filter.</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left font-semibold text-gray-700">Product</th>
            <th className="px-3 py-3 text-right font-semibold text-gray-700">Stock</th>
            <th className="px-2 py-3 text-center font-semibold text-gray-700">L (in)</th>
            <th className="px-2 py-3 text-center font-semibold text-gray-700">W (in)</th>
            <th className="px-2 py-3 text-center font-semibold text-gray-700">H (in)</th>
            <th className="px-2 py-3 text-center font-semibold text-gray-700">Weight (lb)</th>
            <th className="px-3 py-3 text-left font-semibold text-gray-700">Source</th>
            <th className="px-4 py-3 text-right font-semibold text-gray-700"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row) => {
            const draft = drafts[row.id] ?? draftFor(row)
            const dirty = isDirty(row)
            const busy = savingId === row.id
            return (
              <tr key={row.id} className={row.problem ? 'bg-amber-50/40' : undefined}>
                <td className="px-4 py-3 align-top">
                  <div className="font-medium text-gray-900">{row.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-gray-500">
                    <span className="font-mono">{row.sku || '—'}</span>
                    {row.packSpec && <span>· {row.packSpec}</span>}
                    {row.unitsPerCase && <span>· {row.unitsPerCase.toLocaleString()}/case</span>}
                    {row.manuallyHidden && <span className="text-gray-400">· hidden</span>}
                  </div>
                  {row.problem && (
                    <div className="mt-1 text-xs font-medium text-amber-700">⚠ {row.problem}</div>
                  )}
                  {errors[row.id] && <div className="mt-1 text-xs font-medium text-red-600">{errors[row.id]}</div>}
                </td>
                <td className="px-3 py-3 align-top text-right tabular-nums text-gray-600">
                  {row.stockQty.toLocaleString()}
                </td>
                {(['length', 'width', 'height', 'weight'] as const).map((field) => (
                  <td key={field} className="px-2 py-3 align-top text-center">
                    <input
                      inputMode="decimal"
                      value={draft[field]}
                      onChange={(e) => edit(row, field, e.target.value)}
                      disabled={busy}
                      aria-label={`${row.sku || row.name} case ${field}`}
                      className={CELL_CLASS}
                    />
                  </td>
                ))}
                <td className="px-3 py-3 align-top text-xs text-gray-500">
                  {row.source ? (
                    <>
                      <span
                        className={
                          row.source === 'manual'
                            ? 'rounded bg-green-100 px-1.5 py-0.5 font-semibold text-green-800'
                            : 'rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-700'
                        }
                      >
                        {row.source}
                      </span>
                      {row.updatedBy && <div className="mt-1 truncate max-w-[10rem]">{row.updatedBy}</div>}
                      {row.updatedAt && <div className="text-gray-400">{row.updatedAt.slice(0, 10)}</div>}
                    </>
                  ) : (
                    <span className="text-gray-400">not measured</span>
                  )}
                </td>
                <td className="px-4 py-3 align-top text-right">
                  <div className="flex items-center justify-end gap-2">
                    {saved[row.id] && !dirty && <span className="text-xs font-medium text-green-700">Saved</span>}
                    {dirty && (
                      <button
                        onClick={() => save(row)}
                        disabled={busy}
                        className="rounded-md bg-gray-900 px-3 py-1 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
                      >
                        {busy ? 'Saving…' : 'Save'}
                      </button>
                    )}
                    {!dirty && row.problem && (
                      <button
                        onClick={() => clear(row)}
                        className="rounded-md border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                        title="Empty the fields, then Save to put this product back on the needs-measuring list"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
