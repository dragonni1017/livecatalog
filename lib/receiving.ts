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

// ── Duplicate-apply guards ───────────────────────────────────────────────────
//
// The three guards already in apply/route.ts (status, per-line applied_at,
// unique file_hash) all reason about ONE shipment row, so neither of the
// duplicates that actually happened on 2026-09-23 was visible to them:
//
//  - the supplier sends an "Original List" and an "Arrival List" for the same
//    container, so the two files differ and file_hash correctly does not
//    match -- 165,896 pieces of near-miss;
//  - scripts/add-stock-from-arrival-lists.mjs had already stocked container
//    EGSU9509206 on 2026-09-03 and left no shipments row at all, so from the
//    app's point of view it had never been received -- 5,200 pieces really
//    were added twice.
//
// Both predicates below are pure so the screen and the route decide
// identically, the same reason isStockAppliable/isCreatable live here.
// See docs/RECEIVING-DUPLICATE-GUARDS-SCOPE.md.

/**
 * The container id out of a supplier file name, e.g.
 * "2026-09 ETD 0904 697ctn Arrival List ETA 09-17-2026 Cntr#EGSU8096690 MBL#..."
 * -> "EGSU8096690".
 *
 * Derived rather than typed: `container_ref` has existed since migration 0048
 * and was null on all 9 shipments, because the only thing that set it was an
 * optional text box. Every file name in this workflow carries the container.
 */
export function containerRefFromFileName(fileName: string): string | null {
  // Case-insensitive: at least one real file writes "cntr#" in lower case.
  // Requiring letters-then-digits is what skips the carton count in
  // "Cntr#EGSU8749711 cntr#762" -- and since exec takes the first match,
  // the real container wins even when the decoy comes first.
  const m = /Cntr#\s*([A-Za-z]{3,4}\s?\d{6,7})/i.exec(fileName)
  if (!m) return null
  return m[1].replace(/\s+/g, '').toUpperCase()
}

export interface PriorRegistrationRow {
  productId: number
  amount: number
  documentId: number
  date: string
}

export interface IntendedRegistration {
  sku: string
  productId: number
  addQty: number
}

export interface DuplicateRegistration extends IntendedRegistration {
  documentId: number
  date: string
}

/**
 * Rows this apply would write that Erply has already registered at the SAME
 * quantity.
 *
 * Equal quantity is the whole signal, and it is not a guess: it is the rule
 * scripts/writeoff-double-added-stock.mjs was run against real data with on
 * 2026-09-23, where it caught all four genuine duplicates and correctly left
 * P273810-60cm alone -- that SKU was registered 1,056 then 372, two real
 * arrivals of the same product. Same product + same amount means one shipment
 * keyed twice; a different amount means it genuinely came on two containers.
 *
 * Deliberately advisory. Two real shipments CAN carry an identical quantity
 * (a full case pack is a round number), so the caller warns and asks rather
 * than blocking -- see the confirm flags on apply/route.ts.
 */
export function findDuplicateRegistrations(
  intended: IntendedRegistration[],
  prior: PriorRegistrationRow[],
): DuplicateRegistration[] {
  const byProduct = new Map<number, PriorRegistrationRow[]>()
  for (const row of prior) {
    const list = byProduct.get(row.productId)
    if (list) list.push(row)
    else byProduct.set(row.productId, [row])
  }

  const hits: DuplicateRegistration[] = []
  for (const item of intended) {
    const matches = (byProduct.get(item.productId) ?? []).filter((p) => p.amount === item.addQty)
    if (matches.length === 0) continue
    // Most recent prior registration is the useful one to show.
    const latest = matches.reduce((a, b) => (a.date >= b.date ? a : b))
    hits.push({ ...item, documentId: latest.documentId, date: latest.date })
  }
  return hits
}

// ── Per-container progress ───────────────────────────────────────────────────

export interface SummaryLine extends ReceivingLine {
  sku: string
  invoice_line_no?: number | null
}

/** What the catalog knows about a SKU this shipment created. */
export interface SummaryProduct {
  price_cents: number | null
  image_url: string | null
}

export interface ShipmentProgress {
  /** Lines that need a product created before their stock can be registered. */
  toCreate: number
  created: number
  /** Of the lines still to create, how many have each field Erply needs. */
  named: number
  categorised: number
  /** Any line joined to a Commercial Invoice line. */
  hasInvoice: boolean
  /** Lines whose stock may still be registered, and what that is worth. */
  appliable: number
  appliablePieces: number
  /** Per-line confirmations actually recorded (see the apply route). */
  linesConfirmed: number
  /** Created SKUs, measured against the catalog rather than this shipment. */
  inCatalog: number
  withPhoto: number
  priced: number
}

/**
 * One container's state, as a projection of rows that already exist.
 *
 * Exists because there was no single place that said where a container was:
 * answering it meant querying by hand, and on 2026-09-23 that produced a
 * confidently wrong answer twice. Pure, and living beside the predicates it
 * reports on, so the screen cannot drift from the rules the routes enforce.
 *
 * `productsBySku` is keyed UPPER-CASE and only needs to contain the SKUs this
 * shipment created; a SKU absent from it simply counts as not in the catalog.
 */
export function summariseShipment(
  lines: SummaryLine[],
  productsBySku: Map<string, SummaryProduct>,
): ShipmentProgress {
  const creatable = lines.filter(isCreatable)
  const createdLines = lines.filter((l) => l.erply_created_product_id)
  const appliableLines = lines.filter(isStockAppliable)

  // Measured on the catalog, not on the shipment: creating a product in Erply
  // does not put it in the catalog, and that gap is the thing worth seeing.
  const createdSkus = [...new Set(createdLines.map((l) => l.sku.toUpperCase()))]
  const products = createdSkus.map((s) => productsBySku.get(s)).filter((p): p is SummaryProduct => !!p)

  return {
    toCreate: creatable.length,
    created: createdLines.length,
    named: creatable.filter((l) => l.proposed_name).length,
    categorised: creatable.filter((l) => l.proposed_category).length,
    hasInvoice: lines.some((l) => l.invoice_line_no != null),
    appliable: appliableLines.length,
    appliablePieces: appliableLines.reduce((n, l) => n + (l.qty_received ?? 0), 0),
    linesConfirmed: lines.filter((l) => l.applied_at).length,
    inCatalog: products.length,
    withPhoto: products.filter((p) => p.image_url).length,
    priced: products.filter((p) => (p.price_cents ?? 0) > 0).length,
  }
}
