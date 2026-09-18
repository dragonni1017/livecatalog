import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { logAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// This route lives under /admin, so middleware.ts already gates it behind
// the admin auth cookie — no extra auth check needed here.
//
// Item-list counterpart of ./customer-pull. Triggers/reports on a full
// (unfiltered) pull of QuickBooks' existing ITEM list into qb_item_directory
// via the singleton qb_item_pull_state row. The pull only runs when
// QuickBooks Web Connector next polls /api/qbwc — see handleSendRequestXML's
// item_full_query branch — so this just flips a flag; it can take up to Web
// Connector's poll interval (15 min by default) to start, plus however many
// iterator pages the real item list needs.
//
// Why this exists: QuickBooks Desktop is where new products are set up by
// hand, so its item descriptions are the best source for naming a SKU that
// arrives on a container but isn't in the catalog yet.

// GET — current pull status, plus what's in the directory, for the admin UI.
export async function GET() {
  const db = getAdminClient()
  const { data, error } = await db
    .from('qb_item_pull_state')
    .select('status, pulled_count, error_message, requested_at, completed_at')
    .eq('id', 1)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { count: directoryCount } = await db
    .from('qb_item_directory')
    .select('qb_item_list_id', { count: 'exact', head: true })

  // How much of the directory would actually help right now: SKUs staged on
  // a shipment that aren't in the catalog and have no name yet. This is the
  // number the pull exists to reduce, so it's worth showing next to it.
  const { data: blanks } = await db
    .from('shipment_lines')
    .select('sku, proposed_name, match_status')
    .eq('match_status', 'unmatched_sku')
    .is('erply_created_product_id', null)

  const blankSkus = (blanks ?? []).filter((l) => !l.proposed_name).map((l) => String(l.sku).toUpperCase())
  let covered = 0
  if (blankSkus.length > 0) {
    const unique = [...new Set(blankSkus)]
    for (let i = 0; i < unique.length; i += 200) {
      const { data: hits } = await db
        .from('qb_item_directory')
        .select('sku')
        .in('sku', unique.slice(i, i + 200))
      covered += new Set((hits ?? []).map((h) => String(h.sku).toUpperCase())).size
    }
  }

  return NextResponse.json({
    pull: data,
    directoryCount: directoryCount ?? 0,
    blankSkuCount: new Set(blankSkus).size,
    blankSkusInQuickBooks: covered,
  })
}

// POST — request a (re)pull. Safe to call again even mid-pull; it resets to
// 'requested' with a fresh iterator, so a stuck or errored pull can always
// be restarted from the beginning.
export async function POST() {
  const db = getAdminClient()
  const { error } = await db
    .from('qb_item_pull_state')
    .update({
      status: 'requested',
      iterator_id: null,
      pulled_count: 0,
      error_message: null,
      requested_at: new Date().toISOString(),
      completed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAudit({ action: 'qb_item_pull_requested', entity_type: 'qb_item_pull' })

  return NextResponse.json({ ok: true })
}
