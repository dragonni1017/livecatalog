import { getAdminClient } from '@/lib/supabase'
import { resolveSkus } from '@/lib/qb-item-directory'
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
    .select('sku, proposed_name, match_status, pieces_per_case')
    .eq('match_status', 'unmatched_sku')
    .is('erply_created_product_id', null)

  // Deduped by upper-cased SKU but resolved through the shared helper, which
  // matches on sku_norm. Comparing an upper-cased SKU against the raw `sku`
  // column here is what made this screen report 40 of 67 when the real
  // answer was 63 — QuickBooks writes "FD400004-25yard", the sheet says
  // "FD400004-25YARD", and Postgres `in` is case-sensitive.
  const blankSkus = [
    ...new Map(
      (blanks ?? [])
        .filter((l) => !l.proposed_name)
        .map((l) => [
          String(l.sku).toUpperCase(),
          // pieces_per_case lets the resolver cross-check the case pack the
          // QuickBooks description quotes — the difference between naming a
          // box of flowers "Chenille Stems Gerbera Daisies" and "White Heart
          // Triple Set Fuzzy".
          { sku: String(l.sku), piecesPerCase: l.pieces_per_case == null ? null : Number(l.pieces_per_case) },
        ]),
    ).values(),
  ]
  const resolutions = blankSkus.length > 0 ? await resolveSkus(db, blankSkus) : []
  const blankSkusInQuickBooks = resolutions.filter((r) => r.match).length
  const missingSkus = resolutions.filter((r) => r.problem === 'missing').map((r) => r.sku)
  const ambiguousSkus = resolutions.filter((r) => r.problem === 'ambiguous').map((r) => r.sku)
  const noDescriptionSkus = resolutions.filter((r) => r.problem === 'no_description').map((r) => r.sku)
  const packMismatchSkus = resolutions.filter((r) => r.problem === 'pack_mismatch').map((r) => r.sku)

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
            missingSkus,
            ambiguousSkus,
            noDescriptionSkus,
            packMismatchSkus,
          }}
        />
      </div>
    </div>
  )
}
