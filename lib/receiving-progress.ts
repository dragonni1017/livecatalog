import { summariseShipment, type ShipmentProgress } from './receiving'

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
