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

export interface ReceivingShipment {
  status: string
}

/**
 * Why a shipment may NOT be deleted — empty means it may.
 *
 * Deleting is for a shipment staged against rules that have since changed:
 * `match_status` is decided once at staging and never revisited, and the
 * unique `file_hash` means re-uploading the same workbook reopens the same
 * stale rows rather than reclassifying them. `abandoned` doesn't help either,
 * because the POST lookup doesn't filter on status — so without this, a stale
 * shipment can only be cleared in the SQL editor. That happened for real on
 * EMCU8323054: staged hours before the SKU-casing fix, it had frozen
 * `p273762` as unmatched and would have created a duplicate of the existing
 * P273762 (docs/memory/project-containers-20260917.md).
 *
 * What it is NOT for is undoing a receipt. Registered stock and created
 * products are one-way facts that live in Erply, and these rows are the only
 * record that they happened — deleting that record wouldn't reverse the
 * action, just hide it, and the next upload of the same file would happily
 * register the whole container a second time. So any irreversible work at all
 * blocks the delete, and the reasons are returned rather than collapsed into
 * a boolean so the caller can say which one applies.
 */
export function blockersForDelete(shipment: ReceivingShipment, lines: ReceivingLine[]): string[] {
  const blockers: string[] = []
  if (shipment.status === 'applied') blockers.push('the shipment is marked applied')

  const applied = lines.filter((l) => l.applied_at).length
  if (applied > 0) blockers.push(`${applied} line(s) have already had their stock registered in Erply`)

  const created = lines.filter((l) => l.erply_created_product_id).length
  if (created > 0) blockers.push(`${created} line(s) created a product in Erply`)

  return blockers
}
