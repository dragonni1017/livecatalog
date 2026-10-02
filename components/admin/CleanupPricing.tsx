'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { readApiError, TRANSPORT_ERROR } from '@/lib/admin-fetch'
import { MAX_SKUS_PER_REQUEST } from '@/lib/needs-pricing'

// "Needs pricing" tab of /admin/cleanup. Prices are never set here (Dragon,
// 2026-10-02): they are entered in Erply by hand and the Erply sync carries
// them into price_cents. This screen only
//   - pulls prices from Erply on demand (POST /admin/api/cleanup/pull-prices),
//     instead of waiting for the 08:00 UTC sync, and
//   - unhides receiving-cohort products once they have a price
//     (POST /admin/api/cleanup/unhide).

export interface ReadyRow {
  id: string
  sku: string
  name: string
  priceCents: number
  stockQty: number
  thumb: string | null
}

export interface UnpricedRow {
  id: string
  sku: string
  name: string
  thumb: string | null
  casePieces: number | null
  arrivedAt: string | null
  /** Distinct QuickBooks sales prices for this SKU, in dollars. Reference only. */
  qbPrices: number[]
  inQuickBooks: boolean
  /**
   * Created by receiving. Rows outside the cohort won't show up under Ready
   * to show once priced -- unhiding those is a call made in /admin/products.
   */
  inCohort: boolean
}

interface Props {
  ready: ReadyRow[]
  unpriced: UnpricedRow[]
}

interface UnhideResult {
  unhidden: string[]
  skipped: Array<{ sku: string; reason: string }>
}

interface PullResult {
  updated: Array<{ sku: string; from: number; to: number }>
  stillZeroInErply: string[]
  notInErply: string[]
  skipped: Array<{ sku: string; reason: string }>
  errors: Array<{ sku: string; error: string }>
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`

function Thumb({ src }: { src: string | null }) {
  if (!src) return <span className="text-xs text-gray-400">No photo</span>
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={56} height={56} className="h-14 w-14 rounded object-cover" />
}

export default function CleanupPricing({ ready, unpriced }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [unhideError, setUnhideError] = useState<string | null>(null)
  const [unhideResult, setUnhideResult] = useState<UnhideResult | null>(null)
  const [pullError, setPullError] = useState<string | null>(null)
  const [pullResult, setPullResult] = useState<PullResult | null>(null)

  async function unhide(skus: string[]) {
    setBusy(skus.length === 1 ? `unhide:${skus[0]}` : 'unhide:all')
    setUnhideError(null)
    setUnhideResult(null)
    try {
      const res = await fetch('/admin/api/cleanup/unhide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skus }),
      })
      const err = await readApiError(res, 'Unhide failed.')
      if (err) {
        setUnhideError(err)
        return
      }
      setUnhideResult((await res.json()) as UnhideResult)
      router.refresh()
    } catch {
      setUnhideError(TRANSPORT_ERROR)
    } finally {
      setBusy(null)
    }
  }

  function unhideAll() {
    const skus = ready.slice(0, MAX_SKUS_PER_REQUEST).map((r) => r.sku)
    if (skus.length === 0) return
    const ok = window.confirm(
      `Put ${skus.length} product${skus.length === 1 ? '' : 's'} on the storefront? Customers will be able to order ${skus.length === 1 ? 'it' : 'them'} straight away.`,
    )
    if (ok) void unhide(skus)
  }

  async function pullPrices() {
    const skus = unpriced.slice(0, MAX_SKUS_PER_REQUEST).map((r) => r.sku)
    if (skus.length === 0) return
    setBusy('pull')
    setPullError(null)
    setPullResult(null)
    try {
      const res = await fetch('/admin/api/cleanup/pull-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skus }),
      })
      const err = await readApiError(res, 'Pulling prices from Erply failed.')
      if (err) {
        setPullError(err)
        return
      }
      setPullResult((await res.json()) as PullResult)
      router.refresh()
    } catch {
      setPullError(TRANSPORT_ERROR)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-10">
      {/* ── Ready to show ─────────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Ready to show ({ready.length})</h2>
            <p className="mt-1 text-sm text-gray-500">
              Products created by receiving that now have a price but are still hidden. Products hidden for any
              other reason never appear here and stay hidden.
            </p>
          </div>
          {ready.length > 0 && (
            <button
              type="button"
              onClick={unhideAll}
              disabled={busy !== null}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              {busy === 'unhide:all'
                ? 'Unhiding…'
                : `Unhide all shown (${Math.min(ready.length, MAX_SKUS_PER_REQUEST)})`}
            </button>
          )}
        </div>
        {unhideError && <p className="mb-3 text-sm text-red-600">{unhideError}</p>}
        {unhideResult && (
          <div className="mb-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700">
            <p>
              Put on the storefront: {unhideResult.unhidden.length}
              {unhideResult.unhidden.length > 0 && (
                <span className="font-mono text-xs text-gray-500"> {unhideResult.unhidden.join(', ')}</span>
              )}
            </p>
            {unhideResult.skipped.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-amber-700">
                {unhideResult.skipped.map((s) => (
                  <li key={s.sku}>
                    <span className="font-mono text-xs">{s.sku}</span> skipped: {s.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Photo</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3 text-right">Catalog price</th>
                <th className="px-4 py-3 text-right">Stock</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ready.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    Nothing priced and waiting. Price products in Erply, then pull prices below.
                  </td>
                </tr>
              )}
              {ready.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-3 font-mono text-xs text-gray-700 whitespace-nowrap">{r.sku}</td>
                  <td className="px-4 py-3">
                    <Thumb src={r.thumb} />
                  </td>
                  <td className="px-4 py-3 text-gray-900">{r.name}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-900">{dollars(r.priceCents)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">{r.stockQty.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => void unhide([r.sku])}
                      disabled={busy !== null}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors"
                    >
                      {busy === `unhide:${r.sku}` ? 'Unhiding…' : 'Unhide'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Price in Erply ────────────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Price in Erply ({unpriced.length})</h2>
            <p className="mt-1 max-w-3xl text-sm text-gray-500">
              Active products with no price. Prices can&apos;t be set here: enter each one in Erply, then pull. The
              catalog shows the Erply price rounded to the nearest quarter (never .75). Pulling never unhides
              anything.
            </p>
          </div>
          {unpriced.length > 0 && (
            <button
              type="button"
              onClick={() => void pullPrices()}
              disabled={busy !== null}
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              {busy === 'pull'
                ? 'Pulling from Erply…'
                : `Pull prices from Erply now (${Math.min(unpriced.length, MAX_SKUS_PER_REQUEST)})`}
            </button>
          )}
        </div>
        {unpriced.length > MAX_SKUS_PER_REQUEST && (
          <p className="mb-3 text-xs text-gray-500">
            Pulls the first {MAX_SKUS_PER_REQUEST} shown; run it again for the rest.
          </p>
        )}
        {pullError && <p className="mb-3 text-sm text-red-600">{pullError}</p>}
        {pullResult && (
          <div className="mb-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700">
            <p>
              Priced from Erply: {pullResult.updated.length} · still $0 in Erply:{' '}
              {pullResult.stillZeroInErply.length} · not found in Erply: {pullResult.notInErply.length}
            </p>
            {pullResult.updated.length > 0 && (
              <ul className="mt-2 list-disc pl-5">
                {pullResult.updated.map((u) => (
                  <li key={u.sku}>
                    <span className="font-mono text-xs">{u.sku}</span> {dollars(u.from)} → {dollars(u.to)}
                  </li>
                ))}
              </ul>
            )}
            {pullResult.notInErply.length > 0 && (
              <p className="mt-2 text-amber-700">
                Not among Erply&apos;s active products:{' '}
                <span className="font-mono text-xs">{pullResult.notInErply.join(', ')}</span>
              </p>
            )}
            {pullResult.skipped.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-amber-700">
                {pullResult.skipped.map((s) => (
                  <li key={s.sku}>
                    <span className="font-mono text-xs">{s.sku}</span> skipped: {s.reason}
                  </li>
                ))}
              </ul>
            )}
            {pullResult.errors.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-red-600">
                {pullResult.errors.map((e) => (
                  <li key={e.sku}>
                    <span className="font-mono text-xs">{e.sku}</span> failed: {e.error}
                  </li>
                ))}
              </ul>
            )}
            {pullResult.updated.length > 0 && (
              <p className="mt-2 text-gray-500">
                Newly priced products from receiving now appear under Ready to show, still hidden.
              </p>
            )}
          </div>
        )}
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Photo</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3 text-right">Case size</th>
                <th className="px-4 py-3">Arrived</th>
                <th className="px-4 py-3 text-right normal-case">
                  QuickBooks price (reference)
                  <div className="font-normal text-gray-400">enter the real price in Erply</div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {unpriced.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                    Every active product has a price.
                  </td>
                </tr>
              )}
              {unpriced.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-3 font-mono text-xs text-gray-700 whitespace-nowrap">{r.sku}</td>
                  <td className="px-4 py-3">
                    <Thumb src={r.thumb} />
                  </td>
                  <td className="px-4 py-3 text-gray-900">
                    {r.name}
                    {!r.inCohort && (
                      <div className="mt-1 text-xs text-amber-700">
                        Not from receiving: once priced it stays hidden and won&apos;t appear under Ready to show.
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                    {r.casePieces ? `${r.casePieces.toLocaleString()} pcs` : '—'}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-gray-700">
                    {/* ISO date, not toLocaleDateString: server and browser time zones would disagree on hydration */}
                    {r.arrivedAt ? r.arrivedAt.slice(0, 10) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                    {!r.inQuickBooks ? (
                      <span className="text-xs text-gray-400">not in QuickBooks</span>
                    ) : r.qbPrices.length === 0 ? (
                      <span className="text-xs text-gray-400">no price in QuickBooks</span>
                    ) : (
                      <>
                        {r.qbPrices.map((p) => `$${p.toFixed(2)}`).join(' / ')}
                        {r.qbPrices.length > 1 && (
                          <div className="text-xs text-amber-700">several QuickBooks items, prices differ</div>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
