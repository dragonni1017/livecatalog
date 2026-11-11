import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'
import { resolveCdnImage } from '@/lib/image'
import { buildExport } from '@/lib/woo-export'
import { loadExportData } from '@/lib/woo-export-load'
import { loadHiddenSearchDemand } from '@/lib/hidden-search-demand-load'
import { HIDE_ACTION, keptHidden, orderCandidates, SHOW_REVIEW_KEEP, SHOW_REVIEW_REOPEN, soldOutHidden, VISIBILITY_ACTION, type HideRow } from '@/lib/show-review'
import ShowReviewCards, { type ShowCard } from '@/components/admin/ShowReviewCards'

export const dynamic = 'force-dynamic'

// "Show these?": hidden products missing nothing but the decision to show
// them (photo, price, category, real description). Show = the audited
// visibility PATCH; Keep hidden = an audit-row decision (lib/show-review.ts).
// Products hidden as sold out are left off while still out of stock: that
// isn't a decision to make here.
export default async function ShowReviewPage() {
  const db = getAdminClient()
  const [{ products, categoryOf }, demand] = await Promise.all([loadExportData(db), loadHiddenSearchDemand(db)])
  const { almost } = buildExport(products, categoryOf, { images: false, categories: false })
  const onlyHidden = new Set(almost.filter((a) => a.missing.length === 1 && a.missing[0] === 'hidden on purpose').map((a) => a.sku))
  const searches = new Map((demand ?? []).map((d) => [d.product.id, d.times]))
  const candidates = products.filter((p) => p.sku && onlyHidden.has(p.sku.trim()))

  const ids = candidates.map((p) => p.id)
  const decisions: HideRow[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db
      .from('audit_log')
      .select('entity_id, action, created_at, performed_by')
      .in('action', [SHOW_REVIEW_KEEP, SHOW_REVIEW_REOPEN, HIDE_ACTION, VISIBILITY_ACTION])
      .in('entity_id', ids.slice(i, i + 200))
    if (error) throw error
    decisions.push(...((data ?? []) as HideRow[]))
  }
  const kept = keptHidden(decisions)
  // Restocked since the sold-out hide: back to being a real decision.
  const hiddenSoldOut = soldOutHidden(decisions)
  const soldOut = new Set(candidates.filter((p) => hiddenSoldOut.has(p.id) && (p.stock_qty ?? 0) <= 0).map((p) => p.id))

  const cards: ShowCard[] = orderCandidates(
    candidates.filter((p) => !soldOut.has(p.id)).map((p) => ({
      id: p.id,
      sku: p.sku!.trim(),
      name: p.name,
      description: p.description ?? '',
      priceCents: p.price_cents ?? 0,
      stock: p.stock_qty ?? 0,
      category: categoryOf(p) ?? '',
      searches: searches.get(p.id) ?? 0,
      thumb: resolveCdnImage(p.image_url, 240),
      kept: kept.has(p.id),
    })),
  )
  const toDecide = cards.filter((c) => !c.kept)

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-10">
        <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700">← Back to Dashboard</Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Show these?</h1>
        <p className="mt-1 text-sm text-gray-500">
          {toDecide.length} hidden product{toDecide.length === 1 ? ' has' : 's have'} everything a shown product needs: a photo, a
          price, a category and a description. Only the decision is left. Most searched first. Show puts it on the storefront
          (and in the WooCommerce export); Keep hidden takes it off this list. Both are logged and can be undone.
          {soldOut.size > 0 && ` ${soldOut.size} more ${soldOut.size === 1 ? 'was' : 'were'} hidden as sold out and ${soldOut.size === 1 ? "isn't" : "aren't"} listed.`}
        </p>
        <div className="mt-6">
          <ShowReviewCards cards={cards} />
        </div>
      </div>
    </div>
  )
}
