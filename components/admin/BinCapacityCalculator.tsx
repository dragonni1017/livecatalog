'use client'

import { useState } from 'react'
import { readApiError, TRANSPORT_ERROR } from '@/lib/admin-fetch'
import { BINDING_LABELS, type BindingConstraint } from '@/lib/bin-capacity'

interface TypeCapacity {
  id: string
  name: string
  dimensions: {
    length_in: number | null
    width_in: number | null
    height_in: number | null
    max_weight_lb: number | null
  }
  binCount: number
  casesPerBin?: number
  casesByVolume?: number
  casesByWeight?: number | null
  binding?: BindingConstraint
  orientation?: [number, number, number] | null
  volumeUtilisation?: number
  loadedWeightLb?: number | null
  casesAcrossAllBins?: number
  binsForCurrentStock?: number | null
  missing?: 'bin-dimensions' | 'carton-dimensions'
}

interface CapacityResponse {
  product: {
    sku: string
    name: string
    stockQty: number
    unitsPerCase: number | null
    casesInStock: number | null
    caseLengthIn: number | null
    caseWidthIn: number | null
    caseHeightIn: number | null
    caseWeightLb: number | null
  }
  matches: { sku: string; name: string }[]
  binTypes: TypeCapacity[]
}

const INPUT =
  'rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500'

export default function BinCapacityCalculator() {
  const [query, setQuery] = useState('')
  const [data, setData] = useState<CapacityResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function run(term: string) {
    if (!term.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/admin/api/bins/capacity?q=${encodeURIComponent(term.trim())}`)
      const err = await readApiError(res, 'Could not work out capacity.')
      if (err) {
        setError(err)
        setData(null)
        return
      }
      const json = (await res.json()) as CapacityResponse
      setData(json)
      if (!json.product) setError('No product matched that search.')
    } catch {
      setError(TRANSPORT_ERROR)
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  const product = data?.product
  const cartonKnown =
    product != null &&
    product.caseLengthIn != null &&
    product.caseWidthIn != null &&
    product.caseHeightIn != null

  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-5 py-4">
        <h2 className="text-base font-semibold text-gray-900">How much fits where</h2>
        <p className="mt-0.5 text-sm text-gray-500">
          Pick a product and see how many cases go in each bin type. Cases all in one orientation, in a grid —
          a real packer turning boxes to fill gaps will beat this, so read it as a floor, not a target.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          run(query)
        }}
        className="flex flex-wrap items-center gap-3 border-b border-gray-200 px-5 py-3"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="SKU or product name…"
          className={`${INPUT} w-64`}
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40"
        >
          {loading ? 'Working…' : 'Calculate'}
        </button>
        {error && <span className="text-sm font-medium text-red-600">{error}</span>}
      </form>

      {data && product && (
        <div className="px-5 py-4">
          <div className="mb-4">
            <div className="font-medium text-gray-900">{product.name}</div>
            <div className="mt-0.5 text-xs text-gray-500">
              <span className="font-mono">{product.sku}</span>
              {cartonKnown ? (
                <>
                  {' · carton '}
                  {product.caseLengthIn} × {product.caseWidthIn} × {product.caseHeightIn} in
                  {product.caseWeightLb != null && ` · ${product.caseWeightLb} lb`}
                </>
              ) : (
                <span className="ml-1 font-medium text-amber-700">· carton not measured yet</span>
              )}
              {' · '}
              {product.stockQty.toLocaleString()} units in stock
              {product.casesInStock != null
                ? ` (${product.casesInStock.toLocaleString()} cases at ${product.unitsPerCase?.toLocaleString()}/case)`
                : ' (cases unknown — no pack spec in the name)'}
            </div>
          </div>

          {data.matches.length > 0 && (
            <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
              <span className="font-semibold">{data.matches.length} products matched.</span> Showing the first.
              <div className="mt-1 flex flex-wrap gap-2">
                {data.matches.slice(0, 12).map((m) => (
                  <button
                    key={m.sku}
                    onClick={() => {
                      setQuery(m.sku)
                      run(m.sku)
                    }}
                    className="rounded border border-gray-300 bg-white px-2 py-0.5 font-mono hover:bg-gray-100"
                  >
                    {m.sku}
                  </button>
                ))}
              </div>
            </div>
          )}

          {!cartonKnown ? (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              This product&apos;s carton hasn&apos;t been measured, so nothing can be worked out for it yet.
              Measure it on the{' '}
              <a href="/admin/measurements" className="font-semibold underline">
                measurements screen
              </a>
              .
            </p>
          ) : data.binTypes.length === 0 ? (
            <p className="text-sm text-gray-500">No bin types defined yet — add one above.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left font-semibold text-gray-700">Bin type</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-700">Cases/bin</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Limited by</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-700">Space fill</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-700">Loaded</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-700">Bins</th>
                    <th className="px-3 py-2 text-right font-semibold text-gray-700">Whole-warehouse</th>
                    <th className="px-4 py-2 text-right font-semibold text-gray-700">Bins for stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.binTypes.map((t) => {
                    if (t.missing) {
                      return (
                        <tr key={t.id} className="text-gray-400">
                          <td className="px-4 py-2 text-gray-700">{t.name}</td>
                          <td colSpan={7} className="px-3 py-2 text-xs">
                            {t.missing === 'bin-dimensions'
                              ? 'Bin type has no dimensions recorded'
                              : 'Carton not measured'}
                          </td>
                        </tr>
                      )
                    }
                    const doesNotFit = t.binding === 'does-not-fit'
                    return (
                      <tr key={t.id} className={doesNotFit ? 'bg-amber-50/40' : undefined}>
                        <td className="px-4 py-2">
                          <div className="text-gray-900">{t.name}</div>
                          <div className="text-xs text-gray-400">
                            {t.dimensions.length_in} × {t.dimensions.width_in} × {t.dimensions.height_in} in
                            {t.dimensions.max_weight_lb != null
                              ? ` · max ${t.dimensions.max_weight_lb.toLocaleString()} lb`
                              : ' · no weight limit recorded'}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-gray-900">
                          {doesNotFit ? '—' : t.casesPerBin?.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600">
                          {t.binding ? BINDING_LABELS[t.binding] : '—'}
                          {!doesNotFit && (
                            <div className="text-gray-400">
                              space {t.casesByVolume?.toLocaleString()}
                              {t.casesByWeight != null
                                ? ` · weight ${t.casesByWeight.toLocaleString()}`
                                : ' · weight unknown'}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                          {doesNotFit ? '—' : `${Math.round((t.volumeUtilisation ?? 0) * 100)}%`}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                          {t.loadedWeightLb != null ? `${t.loadedWeightLb.toLocaleString()} lb` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                          {t.binCount.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-600">
                          {doesNotFit ? '—' : t.casesAcrossAllBins?.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                          {t.binsForCurrentStock == null
                            ? '—'
                            : t.binsForCurrentStock.toLocaleString()}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-gray-400">
                &ldquo;Whole-warehouse&rdquo; is cases per bin × bins of that type, so it assumes every bin of the
                type is empty and dedicated to this product. Stacking strength isn&apos;t modelled — the weight
                limit is the shelf&apos;s, not the bottom carton&apos;s.
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
