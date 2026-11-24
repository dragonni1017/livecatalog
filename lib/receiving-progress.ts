import { findContentMatches, summariseShipment, type PriorShipmentLine, type ShipmentProgress } from './receiving'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = { from: (table: string) => any }

/**
 * Per-container progress for a set of shipments.
 *
 * Separate from lib/receiving.ts so that file stays pure and unit-testable;
 * this is the thin database half. Shared by the receiving page (first paint)
 * and GET /admin/api/shipments (refresh after an action) so the two cannot
 * disagree about where a container is.
 *
 * Two queries regardless of how many shipments are passed: the lines table is
 * a few hundred rows, and the products lookup is limited to SKUs these
 * shipments actually created.
 */
export async function loadShipmentProgress(
  db: DB,
  shipmentIds: string[],
): Promise<Record<string, ShipmentProgress>> {
  if (shipmentIds.length === 0) return {}

  const { data: allLines } = await db
    .from('shipment_lines')
    .select(
      'shipment_id, sku, match_status, qty_received, applied_at, erply_created_product_id, proposed_name, proposed_category, proposed_price_cents, invoice_line_no',
    )
    .in('shipment_id', shipmentIds)

  const lines = (allLines ?? []) as Array<{ shipment_id: string } & Parameters<typeof summariseShipment>[0][number]>

  const createdSkus = [...new Set(lines.filter((l) => l.erply_created_product_id).map((l) => l.sku))]
  const productsBySku = new Map<string, { price_cents: number | null; image_url: string | null }>()
  for (let i = 0; i < createdSkus.length; i += 200) {
    const { data } = await db
      .from('products')
      .select('sku, price_cents, image_url')
      .in('sku', createdSkus.slice(i, i + 200))
    for (const p of (data ?? []) as { sku: string; price_cents: number | null; image_url: string | null }[]) {
      productsBySku.set(p.sku.toUpperCase(), { price_cents: p.price_cents, image_url: p.image_url })
    }
  }

  const progress: Record<string, ShipmentProgress> = {}
  for (const id of shipmentIds) {
    progress[id] = summariseShipment(lines.filter((l) => l.shipment_id === id), productsBySku)
  }
  return progress
}

/**
 * Other live shipments carrying the same container.
 *
 * The apply route refuses on this (Guard A), but only at the very end --
 * after the workbook is staged, counts corrected and products created. Both
 * Original/Arrival duplicates on 2026-09-23 were caught by hand before that
 * point. Staging is harmless, so callers surface this as information.
 *
 * Abandoned shipments are excluded: deciding one is a duplicate is exactly
 * how it got abandoned, and re-reporting it would never stop.
 */
export async function otherShipmentsForContainer(
  db: DB,
  containerRef: string | null,
  excludeId?: string,
): Promise<{ id: string; file_name: string; status: string; applied_at: string | null }[]> {
  if (!containerRef) return []
  const { data } = await db
    .from('shipments')
    .select('id, file_name, status, applied_at')
    .eq('container_ref', containerRef)
    .neq('status', 'abandoned')
  return ((data ?? []) as { id: string; file_name: string; status: string; applied_at: string | null }[])
    .filter((s) => s.id !== excludeId)
}

export interface PriorShipmentMatch {
  id: string
  file_name: string
  container_ref: string | null
  status: 'staged' | 'applied'
  applied_at: string | null
  staged_at: string
  // How it was recognised: the container number, matching contents, or both.
  byRef: boolean
  // Lines with the same SKU and shipped quantity, when matched by contents.
  matchedLines: number | null
  share: number | null
}

/**
 * Non-abandoned shipments that look like the file about to be staged: same
 * container number, or mostly the same lines (lib/receiving.ts
 * findContentMatches). Throws on a read failure rather than reporting "no
 * match", which would wave a duplicate through.
 */
export async function findPriorShipments(
  db: DB,
  containerRef: string | null,
  lines: { sku: string; qtyShipped: number }[],
): Promise<PriorShipmentMatch[]> {
  // Both casings: shipment_lines.sku keeps the sheet's casing and Postgres
  // `in` is case-sensitive. findContentMatches compares upper-cased.
  const lookup = [...new Set(lines.flatMap((l) => [l.sku, l.sku.toUpperCase()]))]
  const prior: PriorShipmentLine[] = []
  for (let i = 0; i < lookup.length; i += 200) {
    const chunk = lookup.slice(i, i + 200)
    // Paged: one SKU can sit on many shipments, so a chunk can pass the
    // 1,000-row response cap.
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from('shipment_lines')
        .select('shipment_id, sku, qty_shipped')
        .in('sku', chunk)
        .order('id')
        .range(from, from + 999)
      if (error) throw new Error(`Could not read earlier shipment lines: ${error.message}`)
      prior.push(...((data ?? []) as PriorShipmentLine[]))
      if (!data || data.length < 1000) break
    }
  }

  const candidateIds = [...new Set(prior.map((p) => p.shipment_id))]
  const shipments: (Omit<PriorShipmentMatch, 'byRef' | 'matchedLines' | 'share' | 'status'> & { line_count: number; status: string })[] = []
  const cols = 'id, file_name, container_ref, status, applied_at, staged_at, line_count'
  for (let i = 0; i < candidateIds.length; i += 200) {
    const { data, error } = await db.from('shipments').select(cols).in('id', candidateIds.slice(i, i + 200))
    if (error) throw new Error(`Could not read earlier shipments: ${error.message}`)
    shipments.push(...(data ?? []))
  }
  if (containerRef) {
    // ilike with no wildcards = case-insensitive equals: a typed ref may not
    // be upper-cased like the one read from a file name.
    const { data, error } = await db.from('shipments').select(cols).ilike('container_ref', containerRef)
    if (error) throw new Error(`Could not read earlier shipments: ${error.message}`)
    for (const s of data ?? []) if (!shipments.some((x) => x.id === s.id)) shipments.push(s)
  }

  const live = shipments.filter((s) => s.status !== 'abandoned')
  const content = new Map(
    findContentMatches(
      lines,
      prior.filter((p) => live.some((s) => s.id === p.shipment_id)),
      new Map(live.map((s) => [s.id, s.line_count])),
    ).map((m) => [m.shipmentId, m]),
  )

  return live
    .map((s) => {
      const byRef = !!containerRef && s.container_ref?.toUpperCase() === containerRef.toUpperCase()
      const m = content.get(s.id)
      return {
        id: s.id,
        file_name: s.file_name,
        container_ref: s.container_ref,
        status: s.status as 'staged' | 'applied',
        applied_at: s.applied_at,
        staged_at: s.staged_at,
        byRef,
        matchedLines: m?.matched ?? null,
        share: m?.share ?? null,
      }
    })
    .filter((s) => s.byRef || s.share !== null)
    .sort((a, b) => (a.status === b.status ? b.staged_at.localeCompare(a.staged_at) : a.status === 'applied' ? -1 : 1))
}
