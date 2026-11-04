import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'
import CaseCountReviewTable, { type CaseCountReviewRow } from '@/components/admin/CaseCountReviewTable'

export const dynamic = 'force-dynamic'

// Case-count review queue (migration 0072). Each row is a product whose
// case count in its name disagrees with shipments, QuickBooks or the label,
// with every source listed. Changing it renames the product in Erply,
// WooCommerce and the catalog (lib/product-name-fix.ts); only the case part
// of the pack spec may change.
export default async function CaseCountReviewPage() {
  const db = getAdminClient()
  const { data, error } = await db
    .from('case_count_review_items')
    .select('id, batch, sku, current_name, current_case_pieces, evidence, reason, status, decided_name, result, product:products!case_count_review_items_product_id_fkey(id, name, sold_by, manually_hidden)')
    .order('created_at', { ascending: true })
    .order('sku', { ascending: true })
  const rows = (data ?? []) as unknown as CaseCountReviewRow[]

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-10">
        <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700">← Back to Dashboard</Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Case-count Review</h1>
        <p className="mt-1 text-sm text-gray-500">
          Products whose case count in the name (&quot;12/pk 20bx/cs cs.240&quot; = 240 per case) disagrees with a shipment,
          QuickBooks or the label. Shipments differ from each other too, and older stock may still be on the shelf, so pick
          the count the warehouse actually has. Changing it renames the product in Erply, WooCommerce and the catalog; only
          the case part can change, and only if the name hasn&apos;t changed since this list was made. Prices are per piece or
          pack, so they don&apos;t change.
        </p>
        {error ? (
          <p className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Couldn&apos;t load the review list. If migration 0072 hasn&apos;t been applied yet, apply it first.
          </p>
        ) : (
          <div className="mt-6">
            <CaseCountReviewTable rows={rows} />
          </div>
        )}
      </div>
    </div>
  )
}
