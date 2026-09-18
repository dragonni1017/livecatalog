import { getAdminClient } from '@/lib/supabase'
import ItemPullPanel from './ItemPullPanel'

export const dynamic = 'force-dynamic'

// See app/admin/api/qbwc/item-pull for the trigger/status route, and
// app/api/qbwc/route.ts's item_full_query branch for how the pull actually
// runs against QuickBooks. Migration 0050 creates the two tables.
//
// The counts here are computed server-side rather than fetched by the panel
// on mount so the page is useful on first paint; the panel re-fetches the
// same shape from GET /admin/api/qbwc/item-pull while a pull is live.
export default async function QbItemsPage() {
  const db = getAdminClient()

  const { data: pull } = await db
    .from('qb_item_pull_state')
    .select('status, pulled_count, error_message, requested_at, completed_at')
    .eq('id', 1)
    .maybeSingle()

  const { count: directoryCount } = await db
    .from('qb_item_directory')
    .select('qb_item_list_id', { count: 'exact', head: true })

  const { data: blanks } = await db
    .from('shipment_lines')
    .select('sku, proposed_name, match_status')
    .eq('match_status', 'unmatched_sku')
    .is('erply_created_product_id', null)

  const blankSkus = [...new Set((blanks ?? []).filter((l) => !l.proposed_name).map((l) => String(l.sku).toUpperCase()))]
  let blankSkusInQuickBooks = 0
  for (let i = 0; i < blankSkus.length; i += 200) {
    const { data: hits } = await db
      .from('qb_item_directory')
      .select('sku')
      .in('sku', blankSkus.slice(i, i + 200))
    blankSkusInQuickBooks += new Set((hits ?? []).map((h) => String(h.sku).toUpperCase())).size
  }

  return (
    <div className="min-h-screen bg-gray-50 px-6 py-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">QuickBooks items</h1>
          <a href="/admin/quickbooks" className="text-sm text-gray-500 transition-colors hover:text-gray-700">
            &larr; QuickBooks
          </a>
        </div>

        <ItemPullPanel
          initial={{
            pull: pull as never,
            directoryCount: directoryCount ?? 0,
            blankSkuCount: blankSkus.length,
            blankSkusInQuickBooks,
          }}
        />
      </div>
    </div>
  )
}
