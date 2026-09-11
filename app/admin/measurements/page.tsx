import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'
import MeasurementsTable from '@/components/admin/MeasurementsTable'
import { extractPackSpec, extractUnitsPerCase } from '@/lib/pack'
import { hasCompleteCaseMeasurement, implausibleCaseMeasurement } from '@/lib/measurements'

export const dynamic = 'force-dynamic'

// Carton measurements for warehouse bin capacity (migration 0045).
//
// Deliberately its own screen rather than four more fields on
// /admin/products' edit modal: the job here is working through a list of
// what's still missing, which the products page's name/category/visibility
// filters can't express. That modal stays the place to edit one product's
// name, price or images.
const DISPLAY_PAGE_SIZE = 100

type MeasurementState = 'needs' | 'implausible' | 'measured' | 'all'

const STATE_LABELS: Record<MeasurementState, string> = {
  needs: 'Needs measuring',
  implausible: 'Implausible — recheck',
  measured: 'Measured',
  all: 'All',
}

interface MeasurementRow {
  id: string
  sku: string | null
  name: string
  stock_qty: number
  manually_hidden: boolean
  case_length_in: number | null
  case_width_in: number | null
  case_height_in: number | null
  case_weight_lb: number | null
  measurements_source: string | null
  measurements_updated_at: string | null
  measurements_updated_by: string | null
}

const COLUMNS =
  'id, sku, name, stock_qty, manually_hidden, case_length_in, case_width_in, case_height_in, case_weight_lb, measurements_source, measurements_updated_at, measurements_updated_by'

// Fetches every active product's measurement columns, not just one page's.
//
// Unavoidable, unlike on /admin/products: "implausible" is a density
// calculation that PostgREST can't filter or count on, so the whole set has
// to be classified in JS to get honest counts and an accurate filter. Only
// DISPLAY_PAGE_SIZE rows are ever rendered. Twelve narrow columns over ~3,200
// rows is a few hundred KB server-side; if the catalog grows an order of
// magnitude, this wants a generated column or a view instead.
async function fetchAllRows(db: ReturnType<typeof getAdminClient>): Promise<MeasurementRow[]> {
  const all: MeasurementRow[] = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from('products')
      .select(COLUMNS)
      .eq('is_active', true)
      .order('stock_qty', { ascending: false })
      .range(from, from + pageSize - 1)
    if (error) throw error
    const batch = (data ?? []) as unknown as MeasurementRow[]
    all.push(...batch)
    if (batch.length < pageSize) break
  }
  return all
}

function classify(row: MeasurementRow): Exclude<MeasurementState, 'all'> {
  if (implausibleCaseMeasurement(row) !== null) return 'implausible'
  return hasCompleteCaseMeasurement(row) ? 'measured' : 'needs'
}

export default async function AdminMeasurementsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; q?: string; visibility?: string; page?: string }>
}) {
  const { state: stateParam, q, visibility, page: pageParam } = await searchParams
  const state: MeasurementState =
    stateParam === 'implausible' || stateParam === 'measured' || stateParam === 'all' ? stateParam : 'needs'
  const page = Math.max(1, parseInt(pageParam ?? '1', 10) || 1)

  const db = getAdminClient()
  const allRows = await fetchAllRows(db)

  const counts = { needs: 0, implausible: 0, measured: 0, all: allRows.length }
  for (const row of allRows) counts[classify(row)]++

  const term = q?.trim().toLowerCase()
  const filtered = allRows.filter((row) => {
    if (state !== 'all' && classify(row) !== state) return false
    if (visibility === 'visible' && row.manually_hidden !== false) return false
    if (visibility === 'hidden' && row.manually_hidden !== true) return false
    if (term && !`${row.name} ${row.sku ?? ''}`.toLowerCase().includes(term)) return false
    return true
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / DISPLAY_PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const from = (safePage - 1) * DISPLAY_PAGE_SIZE
  const pageRows = filtered.slice(from, from + DISPLAY_PAGE_SIZE)

  // Pack spec and units/case come from the product name (lib/pack.ts) and are
  // the context that makes a carton figure checkable by eye -- 29 lb is
  // obviously wrong for 12 keychains and obviously fine for 480 of them.
  const tableRows = pageRows.map((row) => ({
    id: row.id,
    sku: row.sku ?? '',
    name: row.name,
    packSpec: extractPackSpec(row.name) ?? '',
    unitsPerCase: extractUnitsPerCase(row.name) || null,
    stockQty: row.stock_qty ?? 0,
    manuallyHidden: row.manually_hidden,
    caseLengthIn: row.case_length_in,
    caseWidthIn: row.case_width_in,
    caseHeightIn: row.case_height_in,
    caseWeightLb: row.case_weight_lb,
    source: row.measurements_source,
    updatedAt: row.measurements_updated_at,
    updatedBy: row.measurements_updated_by,
    problem: implausibleCaseMeasurement(row),
  }))

  const linkFor = (overrides: { state?: MeasurementState; page?: number }) => {
    const params = new URLSearchParams()
    const nextState = overrides.state ?? state
    if (nextState !== 'needs') params.set('state', nextState)
    if (q) params.set('q', q)
    if (visibility) params.set('visibility', visibility)
    const nextPage = overrides.page ?? 1
    if (nextPage > 1) params.set('page', String(nextPage))
    const qs = params.toString()
    return qs ? `/admin/measurements?${qs}` : '/admin/measurements'
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-10">
        <div className="mb-6">
          <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            ← Back to Dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">Carton Measurements</h1>
          <p className="mt-1 text-sm text-gray-500">
            Master-carton size and weight, for warehouse bin capacity.{' '}
            <strong className="font-semibold text-gray-700">Inches and pounds</strong> — not cm or kg.
          </p>
        </div>

        {/* State tabs double as the counts, so the remaining work is always visible */}
        <div className="mb-6 flex flex-wrap gap-2">
          {(Object.keys(STATE_LABELS) as MeasurementState[]).map((key) => {
            const active = key === state
            return (
              <Link
                key={key}
                href={linkFor({ state: key })}
                className={
                  active
                    ? 'rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white'
                    : 'rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors'
                }
              >
                {STATE_LABELS[key]}{' '}
                <span className={active ? 'font-semibold' : 'font-semibold text-gray-900'}>
                  {counts[key].toLocaleString()}
                </span>
              </Link>
            )
          })}
        </div>

        <form method="get" className="mb-6 flex flex-wrap items-center gap-3">
          {state !== 'needs' && <input type="hidden" name="state" value={state} />}
          <input
            type="search"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Search name or SKU…"
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900 w-56"
          />
          <select
            name="visibility"
            defaultValue={visibility ?? ''}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900"
          >
            <option value="">All visibility</option>
            <option value="visible">On the storefront</option>
            <option value="hidden">Hidden</option>
          </select>
          <button
            type="submit"
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 transition-colors"
          >
            Apply
          </button>
          {(q || visibility) && (
            <a
              href={linkFor({})}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
            >
              Clear filters
            </a>
          )}
          <span className="ml-auto text-sm text-gray-500">
            {filtered.length.toLocaleString()} matching
          </span>
        </form>

        {state === 'implausible' && counts.implausible > 0 && (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            These already hold figures, which is what makes them risky — they look measured but can&apos;t be
            real, so a capacity plan built on them would place stock that doesn&apos;t fit. Re-measure the carton
            and overwrite, or clear the fields to put the product back on the &ldquo;needs measuring&rdquo; list.
          </p>
        )}

        <MeasurementsTable rows={tableRows} />

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm text-gray-600">
            <span>
              Showing {(from + 1).toLocaleString()}–
              {Math.min(from + DISPLAY_PAGE_SIZE, filtered.length).toLocaleString()} of{' '}
              {filtered.length.toLocaleString()}
            </span>
            <div className="flex items-center gap-2">
              {safePage > 1 ? (
                <a
                  href={linkFor({ page: safePage - 1 })}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 hover:bg-gray-50 transition-colors"
                >
                  ← Prev
                </a>
              ) : (
                <span className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-1.5 text-gray-300">← Prev</span>
              )}
              <span className="px-2">
                Page {safePage} of {totalPages}
              </span>
              {safePage < totalPages ? (
                <a
                  href={linkFor({ page: safePage + 1 })}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 hover:bg-gray-50 transition-colors"
                >
                  Next →
                </a>
              ) : (
                <span className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-1.5 text-gray-300">Next →</span>
              )}
            </div>
          </div>
        )}

        <p className="mt-6 text-xs text-gray-400">
          Bulk work is faster through the spreadsheet: <code>scripts/build-measurement-worklist.mjs</code> exports
          the outstanding list and <code>scripts/import-measurement-worklist.mjs</code> reads it back. A value saved
          here is marked <code>manual</code> and is never overwritten by the Erply/Woo backfill.
        </p>
      </div>
    </div>
  )
}
