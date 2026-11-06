import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'
import { resolveCdnImage } from '@/lib/image'
import { buildExport } from '@/lib/woo-export'
import { loadExportData } from '@/lib/woo-export-load'
import { loadHiddenSearchDemand } from '@/lib/hidden-search-demand-load'
import { keptHidden, orderCandidates, SHOW_REVIEW_KEEP, SHOW_REVIEW_REOPEN, type DecisionRow } from '@/lib/show-review'
import ShowReviewCards, { type ShowCard } from '@/components/admin/ShowReviewCards'

export const dynamic = 'force-dynamic'

// "Show these?": hidden products missing nothing but the decision to show
// them (photo, price, category, real description). Show = the audited
// visibility PATCH; Keep hidden = an audit-row decision (lib/show-review.ts).
export default async function ShowReviewPage() {
  const db = getAdminClient()
  const [{ products, categoryOf }, demand] = await Promise.all([loadExportData(db), loadHiddenSearchDemand(db)])
  const { almost } = buildExport(products, categoryOf, { images: false, categories: false })
  const onlyHidden = new Set(almost.filter((a) => a.missing.length === 1 && a.missing[0] === 'hidden on purpose').map((a) => a.sku))
  const searches = new Map((demand ?? []).map((d) => [d.product.id, d.times]))
  const candidates = products.filter((p) => p.sku && onlyHidden.has(p.sku.trim()))

  const ids = candidates.map((p) => p.id)
  const decisions: DecisionRow[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db
      .from('audit_log')
      .select('entity_id, action, created_at')
      .in('action', [SHOW_REVIEW_KEEP, SHOW_REVIEW_REOPEN])
      .in('entity_id', ids.slice(i, i + 200))
    if (error) throw error
    decisions.push(...((data ?? []) as DecisionRow[]))
  }
  const kept = keptHidden(decisions)

  const cards: ShowCard[] = orderCandidates(
    candidates.map((p) => ({
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
        </p>
        <div className="mt-6">
          <ShowReviewCards cards={cards} />
        </div>
      </div>
    </div>
  )
}
