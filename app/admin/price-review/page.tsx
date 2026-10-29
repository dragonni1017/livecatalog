import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'
import PriceReviewTable, { type ReviewRow } from '@/components/admin/PriceReviewTable'

export const dynamic = 'force-dynamic'

// Price review queue (migration 0070). Each row is a product whose price
// needs a decision, with a suggestion and the reason. Approve holds the price
// (0068) with an audit row; Skip leaves the price alone.
export default async function PriceReviewPage() {
  const db = getAdminClient()
  const { data, error } = await db
    .from('price_review_items')
    .select('id, batch, sku, grp, note, reason, file_cents, website_cents, suggested_cents, status, decided_cents, decided_at, product:products!price_review_items_product_id_fkey(id, name, stock_qty, price_cents, held_price_cents)')
    .order('created_at', { ascending: true })

  // Not head:true, so a failure shows as an error instead of a silent 0.
  const { data: heldRows } = await db.from('products').select('id').not('held_price_cents', 'is', null)
  const heldCount = heldRows?.length ?? 0

  const rows = (data ?? []) as unknown as ReviewRow[]

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-10">
        <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700">← Back to Dashboard</Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Price Review</h1>
            <p className="mt-1 text-sm text-gray-500">
              Approve sets the website price right away and holds it until Erply has the same price. Skip leaves the price as it is.
            </p>
          </div>
          <a
            href="/admin/api/price-review/erply"
            className="shrink-0 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Download Erply list ({heldCount} to enter)
          </a>
        </div>
        {error ? (
          <p className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Couldn&apos;t load the review list. If migration 0070 hasn&apos;t been applied yet, apply it first.
          </p>
        ) : (
          <div className="mt-6">
            <PriceReviewTable rows={rows} />
          </div>
        )}
      </div>
    </div>
  )
}
