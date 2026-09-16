import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { isStockAppliable } from '@/lib/receiving'
import { getActorEmail } from '@/lib/auth-server'
import { logAudit } from '@/lib/audit'
import {
  getErplyStockIndex,
  isConfigured as isErplyConfigured,
  saveInventoryRegistration,
  type StockRegistrationItem,
} from '@/lib/erply'

export const dynamic = 'force-dynamic'

// The one-way half of receiving: registers received quantities as an Erply
// stock addition. Kept in its own route (not a verb on ../route.ts) because
// Erply has no "set stock to N" call — only deltas — so running this twice
// against the same shipment would double the stock, silently and
// legitimately. Three things stop that:
//
//  1. shipments.status must still be 'staged' (checked and flipped here).
//  2. shipment_lines.applied_at is set per line; already-applied lines are
//     skipped, so a batch that fails halfway can be retried without
//     re-adding what landed.
//  3. shipments.file_hash is unique, so re-uploading the same workbook opens
//     the existing shipment rather than staging a fresh appliable copy.
//
// The caller must also pass confirm_not_yet_received — see the comment on that
// check below. It is the whole reason this screen exists rather than a script.

const RECEIVING_WAREHOUSE_ID = 1

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const shipmentId: string = typeof body.shipment_id === 'string' ? body.shipment_id : ''
    if (!shipmentId) return NextResponse.json({ error: 'Missing shipment_id' }, { status: 400 })

    // Refuses by default rather than trusting a date heuristic. The trap this
    // guards is real and documented: container EMCU8402359's packing list
    // parses perfectly, but the shipment is from 2023 and every SKU on it
    // already reads 0 stock — that inventory was received and sold years ago,
    // and applying the file would inject phantom stock into live inventory.
    // Only a human knows whether a container is still on the water or already
    // on the shelves, so a human has to say so.
    if (body.confirm_not_yet_received !== true) {
      return NextResponse.json(
        {
          error:
            'Confirm that this shipment has not already been received before applying. Applying an old packing list adds stock you already sold.',
        },
        { status: 400 },
      )
    }

    if (!isErplyConfigured()) {
      // Worth a distinct message: on a deployment without the ERPLY_* vars
      // this would otherwise look like a mysterious failure, and the stub
      // path in lib/erply.ts would make a no-op look like a success.
      return NextResponse.json(
        {
          error:
            'Erply is not configured in this environment, so stock cannot be registered. Nothing was changed. Set ERPLY_CLIENT_CODE / ERPLY_USERNAME / ERPLY_PASSWORD here, or apply from an environment that has them.',
        },
        { status: 503 },
      )
    }

    const db = getAdminClient()
    const { data: shipment } = await db.from('shipments').select('*').eq('id', shipmentId).single()
    if (!shipment) return NextResponse.json({ error: 'Shipment not found.' }, { status: 404 })
    if (shipment.status === 'applied') {
      return NextResponse.json(
        { error: 'This shipment was already applied — its stock is in Erply. Applying again would double it.' },
        { status: 409 },
      )
    }
    if (shipment.status === 'abandoned') {
      return NextResponse.json({ error: 'This shipment was abandoned. Re-upload the file to start over.' }, { status: 400 })
    }

    const { data: allLines } = await db
      .from('shipment_lines')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('sku')

    const lines = allLines ?? []

    // Only clean, positive, not-yet-applied lines are eligible — see
    // isStockAppliable for why each half of that matters. A SKU created
    // earlier in this same session DOES qualify: the create step re-resolves
    // its line to 'matched', so one pass can create a container's new
    // products and then receive every line's stock. Barcode mismatches never
    // qualify, and a zero received count is a legitimate "none arrived".
    const eligible = lines.filter(isStockAppliable)

    if (eligible.length === 0) {
      return NextResponse.json(
        { error: 'No lines are eligible to apply — every line is unmatched, zero-quantity, or already applied.' },
        { status: 400 },
      )
    }

    // Resolve SKU -> Erply productID (what saveInventoryRegistration takes)
    // and capture before-stock so the effect can be verified afterward.
    const erplyIndex = await getErplyStockIndex(RECEIVING_WAREHOUSE_ID)
    if (erplyIndex.size === 0) {
      return NextResponse.json(
        { error: 'Erply returned no products, so nothing could be matched. Nothing was changed.' },
        { status: 502 },
      )
    }

    const items: StockRegistrationItem[] = []
    const missingInErply: string[] = []
    const beforeBySku = new Map<string, { productId: number; stockQty: number }>()

    for (const line of eligible) {
      const match = erplyIndex.get(String(line.sku).toUpperCase())
      if (!match) {
        missingInErply.push(line.sku)
        continue
      }
      beforeBySku.set(line.sku, { productId: match.productId, stockQty: match.stockQty })
      items.push({ productId: match.productId, addQty: line.qty_received })
    }

    if (items.length === 0) {
      return NextResponse.json(
        { error: `None of the ${eligible.length} eligible SKUs exist in Erply (e.g. ${missingInErply.slice(0, 5).join(', ')}). Nothing was changed.` },
        { status: 400 },
      )
    }

    const actor = await getActorEmail()

    // Flip the shipment BEFORE calling Erply, and only put it back if Erply
    // positively rejects the request. If this process dies mid-call, the row
    // stays 'applied' with its lines' applied_at still null — visible as an
    // applied shipment whose lines never confirmed, and recoverable by
    // reading stock in Erply. The opposite failure (leaving it 'staged' after
    // a registration that did land) would invite a second apply and silently
    // double the stock, which is not recoverable by inspection.
    await db
      .from('shipments')
      .update({ status: 'applied', applied_at: new Date().toISOString(), applied_by: actor })
      .eq('id', shipmentId)
      .eq('status', 'staged')

    let registered = false
    let registrationError: string | null = null
    try {
      await saveInventoryRegistration(items, RECEIVING_WAREHOUSE_ID)
      registered = true
    } catch (err) {
      registrationError = err instanceof Error ? err.message : String(err)
      console.error('[admin/shipments/apply] registration failed:', registrationError)
    }

    const nowIso = new Date().toISOString()

    if (!registered) {
      // Leave the lines unapplied so a retry is possible, but record why on
      // every line that was in the batch, and put the shipment back to staged
      // since nothing landed.
      for (const line of eligible) {
        await db.from('shipment_lines').update({ apply_error: registrationError }).eq('id', line.id)
      }
      await db.from('shipments').update({ status: 'staged', applied_at: null, applied_by: null }).eq('id', shipmentId)
      return NextResponse.json({ error: `Erply rejected the stock registration: ${registrationError}` }, { status: 502 })
    }

    // Independent re-read rather than trusting the write: the registration
    // response carries a document ID but no per-line results, so the only
    // honest confirmation is asking Erply what the stock is now.
    const afterIndex = await getErplyStockIndex(RECEIVING_WAREHOUSE_ID)

    for (const line of eligible) {
      const before = beforeBySku.get(line.sku)
      if (!before) continue
      const after = afterIndex.get(String(line.sku).toUpperCase())
      await db
        .from('shipment_lines')
        .update({
          erply_product_id: before.productId,
          erply_stock_before: before.stockQty,
          erply_stock_after: after?.stockQty ?? null,
          applied_at: nowIso,
          apply_error: null,
        })
        .eq('id', line.id)
    }

    await logAudit({
      action: 'shipment_applied',
      entity_type: 'shipment',
      entity_id: shipmentId,
      entity_label: shipment.container_ref || shipment.file_name,
      new_value: `${items.length} SKUs, ${items.reduce((sum, i) => sum + i.addQty, 0)} pieces registered in warehouse ${RECEIVING_WAREHOUSE_ID}`,
      performed_by: actor,
    })

    const { data: freshLines } = await db
      .from('shipment_lines')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('sku')
    const { data: freshShipment } = await db.from('shipments').select('*').eq('id', shipmentId).single()

    return NextResponse.json({
      shipment: freshShipment,
      lines: freshLines ?? [],
      applied: items.length,
      piecesRegistered: items.reduce((sum, i) => sum + i.addQty, 0),
      skippedMissingInErply: missingInErply,
      // Supabase's products.stock_qty is deliberately not written here — it
      // catches up on the next Erply stock sync (migration 0042's anchored
      // delta), so the UI can say so rather than leaving the admin wondering
      // why the catalog still shows the old number.
      note: 'Stock was registered in Erply. The catalog\'s own stock figures update on the next Erply stock sync.',
    })
  } catch (err) {
    console.error('[admin/shipments/apply] error:', err)
    return NextResponse.json({ error: 'Failed to apply the shipment.' }, { status: 500 })
  }
}
