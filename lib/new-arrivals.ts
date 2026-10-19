// "New arrivals" = products received in a container recently, dated by when
// the shipment was applied in /admin/receiving (shipments.applied_at).
//
// It used to be products.created_at, which records when a row reached
// Supabase through an import or sync, not when stock arrived. On 2026-10-02
// that left /new-arrivals empty: 0 of 1,185 visible products fell inside 30
// days. Receiving only started 2026-09-23, so arrivals before then aren't
// known.
//
// The date lives on products.arrived_at, kept current by triggers
// (migration 0055, latest_arrival_for_sku): the latest applied shipment that
// received the SKU. Staged or abandoned shipments and zero-qty lines never
// count.

export const NEW_ARRIVAL_DAYS = 30

/** Start of the new-arrivals window, in ms. A helper, so render stays pure. */
export function newArrivalsSinceMs(now: number = Date.now()): number {
  return now - NEW_ARRIVAL_DAYS * 24 * 60 * 60 * 1000
}
