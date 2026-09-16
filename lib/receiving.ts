/**
 * Which shipment lines may be created as products, and which may have their
 * stock registered.
 *
 * Pulled out of the routes as pure predicates because the two rules have to
 * agree: a line that gets created must become stock-appliable in the same
 * pass, or a container's new products land in the catalog with their pieces
 * stranded — the gap that made receiving two half-workflows instead of one.
 */

export interface ReceivingLine {
  match_status: string
  qty_received: number
  applied_at: string | null
  erply_created_product_id: number | null
  proposed_name?: string | null
  proposed_category?: string | null
  proposed_price_cents?: number | null
}

/**
 * Stock may be registered for a line only when the SKU is known to exist
 * (`matched`), some pieces actually arrived, and it hasn't already been
 * applied — `applied_at` is the one-way fact that stops a second add, since
 * Erply's registration API is a delta.
 *
 * A freshly created product qualifies: the create step re-resolves its line
 * to `matched`, because the SKU now exists in Erply.
 *
 * `barcode_mismatch` never qualifies. That status means the SKU IS in the
 * catalog but the sheet's UPC disagrees with the barcode on file, which in
 * this business has meant a wrong SKU mapping often enough to be worth a
 * human look (see docs/memory on barcode collisions). Adding stock to the
 * wrong product is not something a later sync corrects.
 */
export function isStockAppliable(line: ReceivingLine): boolean {
  return line.match_status === 'matched' && line.qty_received > 0 && !line.applied_at
}

/**
 * A product may be created only for a SKU that isn't in the catalog at all.
 *
 * Deliberately excludes `barcode_mismatch`: that SKU already exists, so
 * creating it would either be rejected by Erply as a duplicate code or, worse,
 * produce a second product for the same item. It also excludes anything
 * already created, which is what makes the create step safe to retry.
 */
export function isCreatable(line: ReceivingLine): boolean {
  return line.match_status === 'unmatched_sku' && !line.erply_created_product_id
}

/**
 * Whether a creatable line has everything Erply needs. Kept next to the
 * predicates so the UI's enable/disable logic and the route's validation
 * can't drift apart.
 */
export function missingForCreate(line: ReceivingLine): string[] {
  const missing: string[] = []
  if (!line.proposed_name) missing.push('name')
  if (!line.proposed_category) missing.push('category')
  if (line.proposed_price_cents == null) missing.push('price')
  return missing
}
