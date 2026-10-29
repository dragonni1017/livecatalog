import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'
import NameReviewTable, { type NameReviewRow } from '@/components/admin/NameReviewTable'

export const dynamic = 'force-dynamic'

// Name review queue (migration 0071). Each row is a suggested rename with
// the reason. Rename changes the name in Erply, WooCommerce and the catalog
// (lib/product-name-fix.ts); Skip leaves it.
export default async function NameReviewPage() {
  const db = getAdminClient()
  const { data, error } = await db
    .from('name_review_items')
    .select('id, batch, sku, problem, reason, current_name, suggested_name, status, decided_name, result, product:products!name_review_items_product_id_fkey(id, name)')
    .order('created_at', { ascending: true })
  const rows = (data ?? []) as unknown as NameReviewRow[]

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-10">
        <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700">← Back to Dashboard</Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">Name Review</h1>
        <p className="mt-1 text-sm text-gray-500">
          Rename changes the product name in Erply, WooCommerce and the catalog, and only if the name hasn&apos;t changed since this list was made.
          The pack part of a name (like &quot;12/pk 20bx/cs&quot;) can&apos;t be changed here. Rows with no suggestion need you to type the name.
        </p>
        {error ? (
          <p className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Couldn&apos;t load the review list. If migration 0071 hasn&apos;t been applied yet, apply it first.
          </p>
        ) : (
          <div className="mt-6">
            <NameReviewTable rows={rows} />
          </div>
        )}
      </div>
    </div>
  )
}
