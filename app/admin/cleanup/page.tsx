import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'
import { resolveCdnImage } from '@/lib/image'
import {
  CLEANUP_ISSUES,
  classifyProduct,
  cleanupNameAudit,
  type CleanupFlags,
  type CleanupIssue,
} from '@/lib/cleanup'
import CleanupPhotoDrop from '@/components/admin/CleanupPhotoDrop'
import CleanupRowEditor from '@/components/admin/CleanupRowEditor'
import CleanupNameFix from '@/components/admin/CleanupNameFix'
import CleanupPricing, { type ReadyRow, type UnpricedRow } from '@/components/admin/CleanupPricing'
import { fetchReceivingCohort, isReadyToShow, needsErplyPrice } from '@/lib/needs-pricing'
import { fetchQbItemsBySku } from '@/lib/qb-item-directory'

export const dynamic = 'force-dynamic'

// "Needs attention" queue: products missing a photo, a standard name, a
// category or a description.
//
// Its own screen, like /admin/measurements, because the job is working
// through what's missing -- which /admin/products' filters can't express.
//
// Ownership, decided 2026-10-01:
//  - photos go to Cloudinary and the catalog only (never pushed to Erply/Woo)
//  - descriptions and categories are catalog-owned: the Erply sync sets them
//    on insert only (skipFields), so an edit here survives it
//  - names live in Erply, so a name fix writes Erply + Woo + Supabase via
//    lib/product-name-fix.ts, and only where Erply is configured (locally)
//  - prices are NOT set here (decided 2026-10-02): they're entered in Erply
//    and the Erply sync owns price_cents. The "Needs pricing" tab pulls them
//    early and unhides receiving-cohort products once priced
//    (lib/needs-pricing.ts)
const DISPLAY_PAGE_SIZE = 100

// 'pricing' isn't a classifyProduct flag: "ready to show" depends on the
// receiving cohort, which lives in shipment_lines, not on the product row.
type CleanupTab = CleanupIssue | 'pricing'
const CLEANUP_TABS: CleanupTab[] = [...CLEANUP_ISSUES, 'pricing']

const TAB_LABELS: Record<CleanupTab, string> = {
  photo: 'Needs photo',
  name: 'Name not to standard',
  category: 'No category',
  description: 'No description',
  pricing: 'Needs pricing',
}

interface CleanupDbRow {
  id: string
  sku: string | null
  name: string
  description: string | null
  image_url: string | null
  needs_photo: boolean | null
  category_id: string | null
  manually_hidden: boolean
  is_active: boolean
  stock_qty: number | null
  price_cents: number | null
  case_pieces: number | null
  arrived_at: string | null
}

const COLUMNS =
  'id, sku, name, description, image_url, needs_photo, category_id, manually_hidden, is_active, stock_qty, price_cents, case_pieces, arrived_at'

// Every product, not one page's worth: the counts and the issue filters are
// computed in JS (auditProductName can't run in PostgREST), so the whole set
// is classified here and only DISPLAY_PAGE_SIZE rows are rendered.
//
// Ordered by id, the primary key. range() pagination over a non-unique sort
// is not stable -- tied rows get duplicated into one page and dropped from
// another (cost /admin/measurements 560 silently missing products once).
async function fetchAllRows(db: ReturnType<typeof getAdminClient>): Promise<CleanupDbRow[]> {
  const all: CleanupDbRow[] = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from('products')
      .select(COLUMNS)
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw error
    const batch = (data ?? []) as unknown as CleanupDbRow[]
    all.push(...batch)
    if (batch.length < pageSize) break
  }
  return all
}

// product_ids with at least one product_categories row. Ordered on both key
// columns so the paging is stable for the same reason as above.
async function fetchLinkedProductIds(db: ReturnType<typeof getAdminClient>): Promise<Set<string>> {
  const ids = new Set<string>()
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from('product_categories')
      .select('product_id, category_id')
      .order('product_id', { ascending: true })
      .order('category_id', { ascending: true })
      .range(from, from + pageSize - 1)
    if (error) throw error
    const batch = data ?? []
    for (const r of batch) ids.add(String(r.product_id))
    if (batch.length < pageSize) break
  }
  return ids
}

export default async function AdminCleanupPage({
  searchParams,
}: {
  searchParams: Promise<{ issue?: string; q?: string; visibility?: string; page?: string }>
}) {
  const { issue: issueParam, q, visibility, page: pageParam } = await searchParams
  const issue: CleanupTab = (CLEANUP_TABS as string[]).includes(issueParam ?? '')
    ? (issueParam as CleanupTab)
    : 'photo'
  const page = Math.max(1, parseInt(pageParam ?? '1', 10) || 1)

  const db = getAdminClient()
  const [allRows, linkedIds, { data: categoryData, error: categoryError }, cohort] = await Promise.all([
    fetchAllRows(db),
    fetchLinkedProductIds(db),
    db.from('categories').select('id, name').order('name'),
    fetchReceivingCohort(db),
  ])
  if (categoryError) throw categoryError
  const categories = (categoryData ?? []).map((c) => ({ id: String(c.id), name: String(c.name) }))

  // The queue is active products only: a product Erply has deactivated isn't
  // on the storefront at all, so fixing its photo or copy is wasted effort.
  // Photo MATCHING still uses every SKU (below), so a file named for an
  // inactive product reads as "matched" rather than "unmatched".
  const activeRows = allRows.filter((r) => r.is_active)
  const flagsById = new Map<string, CleanupFlags>()
  for (const row of activeRows) {
    flagsById.set(
      row.id,
      classifyProduct({ ...row, name: row.name ?? '', has_category_link: linkedIds.has(row.id) }),
    )
  }

  const counts: Record<CleanupTab, number> = { photo: 0, name: 0, category: 0, description: 0, pricing: 0 }
  for (const flags of flagsById.values()) {
    for (const key of CLEANUP_ISSUES) if (flags[key]) counts[key]++
  }

  // Highest stock first -- the products actually in the warehouse are the
  // ones a customer can order -- then SKU, so the order is stable.
  activeRows.sort(
    (a, b) => (b.stock_qty ?? 0) - (a.stock_qty ?? 0) || (a.sku ?? '').localeCompare(b.sku ?? ''),
  )

  const term = q?.trim().toLowerCase()
  const matchesTerm = (row: CleanupDbRow) =>
    !term || `${row.name} ${row.sku ?? ''}`.toLowerCase().includes(term)

  // Needs pricing: two lists, unpaginated (~100 rows between them).
  const readyAll = activeRows.filter((r) => r.sku && isReadyToShow(r, cohort))
  const unpricedAll = activeRows
    .filter((r) => r.sku && needsErplyPrice(r))
    // Most recently arrived first: those are the ones on the floor now.
    .sort(
      (a, b) =>
        (b.arrived_at ?? '').localeCompare(a.arrived_at ?? '') || (a.sku ?? '').localeCompare(b.sku ?? ''),
    )
  counts.pricing = readyAll.length + unpricedAll.length

  let readyRows: ReadyRow[] = []
  let unpricedRows: UnpricedRow[] = []
  if (issue === 'pricing') {
    readyRows = readyAll.filter(matchesTerm).map((r) => ({
      id: r.id,
      sku: r.sku as string,
      name: r.name,
      priceCents: r.price_cents ?? 0,
      stockQty: r.stock_qty ?? 0,
      thumb: resolveCdnImage(r.image_url, 56),
    }))
    const unpricedShown = unpricedAll.filter(matchesTerm)
    // QuickBooks is a reference only -- the price still has to be entered in
    // Erply. Matched case-insensitively (sku_norm, migration 0051).
    const qb = await fetchQbItemsBySku(
      db,
      unpricedShown.map((r) => r.sku as string),
    )
    unpricedRows = unpricedShown.map((r) => {
      const items = qb.get((r.sku as string).toUpperCase()) ?? []
      const prices = [
        ...new Set(items.map((i) => Number(i.sales_price)).filter((n) => Number.isFinite(n) && n > 0)),
      ].sort((a, b) => a - b)
      return {
        id: r.id,
        sku: r.sku as string,
        name: r.name,
        thumb: resolveCdnImage(r.image_url, 56),
        casePieces: r.case_pieces,
        arrivedAt: r.arrived_at,
        qbPrices: prices,
        inQuickBooks: items.length > 0,
        inCohort: cohort.has((r.sku as string).trim().toUpperCase()),
      }
    })
  }

  const filtered = activeRows.filter((row) => {
    if (issue === 'pricing' || !flagsById.get(row.id)?.[issue]) return false
    if (visibility === 'visible' && row.manually_hidden !== false) return false
    if (visibility === 'hidden' && row.manually_hidden !== true) return false
    if (!matchesTerm(row)) return false
    return true
  })

  const totalPages = Math.max(1, Math.ceil(filtered.length / DISPLAY_PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const from = (safePage - 1) * DISPLAY_PAGE_SIZE
  const pageRows = filtered.slice(from, from + DISPLAY_PAGE_SIZE)

  // Matching set for the photo drop: every SKU, with whether it already has
  // an image (replacing one is opt-in).
  const photoProducts =
    issue === 'photo'
      ? allRows
          .filter((r) => r.sku && r.sku.trim())
          .map((r) => ({ sku: r.sku as string, hasImage: Boolean((r.image_url ?? '').trim()) }))
      : []

  const linkFor = (overrides: { issue?: CleanupTab; page?: number }) => {
    const params = new URLSearchParams()
    const nextIssue = overrides.issue ?? issue
    if (nextIssue !== 'photo') params.set('issue', nextIssue)
    if (q) params.set('q', q)
    if (visibility) params.set('visibility', visibility)
    const nextPage = overrides.page ?? 1
    if (nextPage > 1) params.set('page', String(nextPage))
    const qs = params.toString()
    return qs ? `/admin/cleanup?${qs}` : '/admin/cleanup'
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-10">
        <div className="mb-6">
          <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            ← Back to Dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">Catalog Cleanup</h1>
          <p className="mt-1 text-sm text-gray-500">
            Active products that still need a photo, a standard name, a category, a description or a price.
          </p>
        </div>

        {/* Issue tabs double as the counts, so the remaining work is always visible */}
        <div className="mb-6 flex flex-wrap gap-2">
          {CLEANUP_TABS.map((key) => {
            const active = key === issue
            return (
              <Link
                key={key}
                href={linkFor({ issue: key })}
                className={
                  active
                    ? 'rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white'
                    : 'rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors'
                }
              >
                {TAB_LABELS[key]}{' '}
                <span className={active ? 'font-semibold' : 'font-semibold text-gray-900'}>
                  {counts[key].toLocaleString()}
                </span>
              </Link>
            )
          })}
        </div>

        <form method="get" className="mb-6 flex flex-wrap items-center gap-3">
          {issue !== 'photo' && <input type="hidden" name="issue" value={issue} />}
          <input
            type="search"
            name="q"
            defaultValue={q ?? ''}
            placeholder="Search name or SKU…"
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900 w-56"
          />
          {/* Everything on the pricing tab is hidden, so the filter would only confuse */}
          {issue !== 'pricing' && (
            <select
              name="visibility"
              defaultValue={visibility ?? ''}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-900"
            >
              <option value="">All visibility</option>
              <option value="visible">On the storefront</option>
              <option value="hidden">Hidden</option>
            </select>
          )}
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
            {(issue === 'pricing' ? readyRows.length + unpricedRows.length : filtered.length).toLocaleString()}{' '}
            matching
          </span>
        </form>

        {issue === 'photo' && <CleanupPhotoDrop products={photoProducts} />}

        {issue === 'name' && (
          <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Names live in Erply, so a fix is written to Erply, WooCommerce and the catalog together — each one
            only if it still holds the name shown here. Only cosmetic fixes are made from this screen: a
            suggestion is offered where the fix is mechanical, and nothing that adds or changes a pack spec is
            accepted. That needs Erply credentials, so it works from a local run, not the live site.
          </p>
        )}

        {issue === 'description' && (
          <p className="mb-4 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-600">
            Descriptions are owned by the catalog: the Erply sync fills one in only when a product is first
            created and never overwrites it after. An Excel import still does.
          </p>
        )}

        {issue === 'pricing' && <CleanupPricing ready={readyRows} unpriced={unpricedRows} />}

        {issue !== 'pricing' && (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">SKU</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3 text-right">Stock</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">{issue === 'photo' ? 'Photo' : 'Fix'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pageRows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                      Nothing left here.
                    </td>
                  </tr>
                )}
                {pageRows.map((row) => {
                  const nameAudit = issue === 'name' ? cleanupNameAudit(row.name ?? '') : null
                  const thumb = issue === 'photo' ? resolveCdnImage(row.image_url, 56) : null
                  return (
                    <tr key={row.id} className="align-top">
                      <td className="px-4 py-3 font-mono text-xs text-gray-700 whitespace-nowrap">{row.sku ?? '—'}</td>
                      <td className="px-4 py-3 text-gray-900">
                        {row.name}
                        {nameAudit && (
                          <div className="mt-1 text-xs text-gray-500">{nameAudit.issues.join(', ')}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                        {(row.stock_qty ?? 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {row.manually_hidden ? (
                          <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">Hidden</span>
                        ) : (
                          <span className="rounded bg-green-50 px-2 py-0.5 text-xs text-green-700">On storefront</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {issue === 'photo' &&
                          (thumb ? (
                            <div className="flex items-center gap-2">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={thumb} alt="" width={56} height={56} className="h-14 w-14 rounded object-cover" />
                              <span className="text-xs text-amber-700">Flagged as needing a new photo</span>
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">No image</span>
                          ))}
                        {issue === 'name' && row.sku && (
                          <CleanupNameFix
                            sku={row.sku}
                            currentName={row.name}
                            suggestion={nameAudit?.suggestion ?? null}
                          />
                        )}
                        {(issue === 'category' || issue === 'description') && (
                          <CleanupRowEditor
                            id={row.id}
                            mode={issue}
                            description={row.description ?? ''}
                            categories={categories}
                          />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {issue !== 'pricing' && totalPages > 1 && (
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
      </div>
    </div>
  )
}
