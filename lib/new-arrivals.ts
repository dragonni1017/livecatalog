// "New arrivals" = products received in a container recently, dated by when
// the shipment was applied in /admin/receiving (shipments.applied_at).
//
// It used to be products.created_at, which records when a row reached
// Supabase through an import or sync, not when stock arrived. On 2026-10-02
// that left /new-arrivals empty: 0 of 1,185 visible products fell inside 30
// days. Receiving only started 2026-09-23, so arrivals before then aren't
// known.

export const NEW_ARRIVAL_DAYS = 30

export interface ShipmentRow {
  id: string
  status: string
  applied_at: string | null
}

export interface ShipmentLineRow {
  shipment_id: string
  sku: string
  qty_received: number
}

/**
 * SKU -> most recent arrival (ISO) among APPLIED shipments on or after
 * `sinceMs`. Lines that received nothing are ignored. A staged or abandoned
 * shipment never counts, since nothing physically arrived through it.
 */
export function latestArrivalBySku(
  shipments: ShipmentRow[],
  lines: ShipmentLineRow[],
  sinceMs: number,
): Map<string, string> {
  const appliedAt = new Map<string, string>()
  for (const s of shipments) {
    if (s.status !== 'applied' || !s.applied_at) continue
    const t = Date.parse(s.applied_at)
    if (Number.isFinite(t) && t >= sinceMs) appliedAt.set(s.id, s.applied_at)
  }
  const bySku = new Map<string, string>()
  for (const l of lines) {
    const at = appliedAt.get(l.shipment_id)
    if (!at || !(l.qty_received > 0)) continue
    const prev = bySku.get(l.sku)
    if (!prev || Date.parse(at) > Date.parse(prev)) bySku.set(l.sku, at)
  }
  return bySku
}

/** Start of the new-arrivals window, in ms. A helper, so render stays pure. */
export function newArrivalsSinceMs(now: number = Date.now()): number {
  return now - NEW_ARRIVAL_DAYS * 24 * 60 * 60 * 1000
}
