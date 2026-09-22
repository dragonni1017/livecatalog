import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { logAudit } from '@/lib/audit'
import { resolveSkus } from '@/lib/qb-item-directory'

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
  const blank = await blankStagedLines(db)
  const blankSkus = [...blank.values()].map((b) => ({ sku: b.sku, piecesPerCase: b.piecesPerCase }))
  const resolutions = blankSkus.length > 0 ? await resolveSkus(db, blankSkus) : []

  return NextResponse.json({
    pull: data,
    directoryCount: directoryCount ?? 0,
    blankSkuCount: blankSkus.length,
    blankSkusInQuickBooks: resolutions.filter((r) => r.match).length,
    // Named separately rather than lumped into one "not found" number: only
    // `missing` is something to act on in QuickBooks.
    missingSkus: resolutions.filter((r) => r.problem === 'missing').map((r) => r.sku),
    ambiguousSkus: resolutions.filter((r) => r.problem === 'ambiguous').map((r) => r.sku),
    noDescriptionSkus: resolutions.filter((r) => r.problem === 'no_description').map((r) => r.sku),
    packMismatchSkus: resolutions.filter((r) => r.problem === 'pack_mismatch').map((r) => r.sku),
  })
}

// Staged lines that aren't in the catalog, have no name yet, and haven't
// already been created — grouped by upper-cased SKU, since the same SKU can
// ship on two containers at once (K229582 does) and both lines want naming.
//
// Line ids are carried through so the write can target them directly. An
// `ilike` on the SKU would be the obvious alternative and is a trap: `_` and
// `%` are LIKE wildcards, so a SKU containing either would quietly match and
// rename other products. None do today, which is exactly the kind of thing
// that stops being true without anyone noticing.
async function blankStagedLines(
  db: ReturnType<typeof getAdminClient>,
): Promise<Map<string, { sku: string; ids: string[]; piecesPerCase: number | null }>> {
  const { data } = await db
    .from('shipment_lines')
    .select('id, sku, proposed_name, match_status, erply_created_product_id, pieces_per_case')
    .eq('match_status', 'unmatched_sku')
    .is('erply_created_product_id', null)

  const grouped = new Map<string, { sku: string; ids: string[]; piecesPerCase: number | null }>()
  for (const l of data ?? []) {
    if (l.proposed_name) continue
    const key = String(l.sku).toUpperCase()
    const entry = grouped.get(key) ?? { sku: String(l.sku), ids: [], piecesPerCase: null }
    entry.ids.push(String(l.id))
    // Carried so the resolver can cross-check the case pack quoted in the
    // QuickBooks description. Two containers shipping one SKU at different
    // packs would make this unsafe to assume, so only a unanimous value is
    // used — a disagreement leaves it null and the check simply doesn't run.
    const ppc = l.pieces_per_case == null ? null : Number(l.pieces_per_case)
    if (entry.ids.length === 1) entry.piecesPerCase = ppc
    else if (entry.piecesPerCase !== ppc) entry.piecesPerCase = null
    grouped.set(key, entry)
  }
  return grouped
}

// PUT — fill proposed_name on every blank staged SKU the directory can name.
//
// Writes only the name. Category and price are the other two things
// missingForCreate() wants, and neither is safe to infer from here: the
// QuickBooks income account is not a catalog category, and pricing is a
// decided manual step in Erply (docs/memory/project-receiving-phase-1.md).
export async function PUT() {
  const db = getAdminClient()
  const blank = await blankStagedLines(db)
  const blankSkus = [...blank.values()].map((b) => ({ sku: b.sku, piecesPerCase: b.piecesPerCase }))
  if (blankSkus.length === 0) return NextResponse.json({ ok: true, filled: 0, lines: 0, missing: [] })

  let resolutions
  try {
    resolutions = await resolveSkus(db, blankSkus)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 })
  }

  let filledLines = 0
  const filledSkus: string[] = []
  for (const r of resolutions) {
    if (!r.match?.sales_desc) continue
    const ids = blank.get(r.sku.toUpperCase())?.ids ?? []
    if (ids.length === 0) continue
    // Target the exact rows read above, and re-assert the blank-name
    // condition in the UPDATE so a name typed by hand between the read and
    // the write is never overwritten.
    const { data: updated, error } = await db
      .from('shipment_lines')
      .update({ proposed_name: r.match.sales_desc })
      .in('id', ids)
      .is('proposed_name', null)
      .is('erply_created_product_id', null)
      .select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    if (updated && updated.length > 0) {
      filledLines += updated.length
      filledSkus.push(r.sku)
    }
  }

  await logAudit({
    action: 'shipment_names_filled_from_quickbooks',
    entity_type: 'shipment_lines',
    new_value: `${filledSkus.length} SKUs / ${filledLines} lines`,
  })

  return NextResponse.json({
    ok: true,
    filled: filledSkus.length,
    lines: filledLines,
    missing: resolutions.filter((r) => r.problem === 'missing').map((r) => r.sku),
    ambiguous: resolutions.filter((r) => r.problem === 'ambiguous').map((r) => r.sku),
    noDescription: resolutions.filter((r) => r.problem === 'no_description').map((r) => r.sku),
    packMismatch: resolutions.filter((r) => r.problem === 'pack_mismatch').map((r) => r.sku),
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
