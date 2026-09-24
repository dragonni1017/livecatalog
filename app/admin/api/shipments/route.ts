import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { getAdminClient } from '@/lib/supabase'
import { getActorEmail } from '@/lib/auth-server'
import { logAudit } from '@/lib/audit'
import {
  groupLinesBySku,
  normalizeBarcode,
  parsePackingListSheet,
  PackingListError,
  type SheetRow,
} from '@/lib/packing-list'
import { blockersForDelete, containerRefFromFileName } from '@/lib/receiving'
import { loadShipmentProgress, otherShipmentsForContainer } from '@/lib/receiving-progress'

export const dynamic = 'force-dynamic'

// Staging half of the receiving flow (see docs/RECEIVING-PHASE-1-SCOPE.md).
// This route only ever writes to Supabase — nothing here touches Erply stock.
// The apply step lives in ./apply/route.ts, deliberately separate so the
// one-way action is its own endpoint.
//
// Lives under /admin, so middleware.ts already gates it behind the admin role.

// GET — list staged/applied shipments with their line counts.
export async function GET() {
  try {
    const db = getAdminClient()
    const { data: shipments, error } = await db
      .from('shipments')
      .select('*')
      .order('staged_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    // Per-container progress, so the screen can say where each one is
    // instead of leaving it to be reconstructed by hand. Shared with the
    // page's first paint via lib/receiving-progress.ts.
    const progress = await loadShipmentProgress(db, (shipments ?? []).map((s) => s.id))

    return NextResponse.json({ shipments: shipments ?? [], progress })
  } catch (err) {
    console.error('[admin/shipments GET] error:', err)
    return NextResponse.json({ error: 'Failed to load shipments.' }, { status: 500 })
  }
}

// POST { file_name, rows, container_ref? } — parse and stage a packing list.
//
// `rows` is the raw sheet as array-of-arrays (XLSX.utils.sheet_to_json with
// header:1), read in the browser the same way ExcelDropzone does for product
// imports. Every rule that decides a quantity runs here, server-side.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const fileName = typeof body.file_name === 'string' ? body.file_name.trim() : ''
    const rows: SheetRow[] = Array.isArray(body.rows) ? body.rows : []
    // Derive the container from the file name, and let a typed value override.
    // container_ref has existed since migration 0048 but was null on all 9
    // shipments, because the only thing that set it was an optional text box
    // nobody fills in -- while every supplier file name carries "Cntr#XXXX".
    // The duplicate-container guard on apply/route.ts has nothing to match on
    // without it, and the audit log silently falls back to the raw file name.
    const typedRef = typeof body.container_ref === 'string' ? body.container_ref.trim() || null : null
    const containerRef = typedRef ?? containerRefFromFileName(fileName)

    if (!fileName) return NextResponse.json({ error: 'Missing file name.' }, { status: 400 })
    if (rows.length === 0) return NextResponse.json({ error: 'The sheet had no rows.' }, { status: 400 })

    // Hash the parsed cell content rather than the file bytes: re-saving the
    // same workbook (or Excel rewriting it on open) changes the bytes while
    // the shipment is unchanged, and re-staging it would let the same
    // container be applied twice.
    const fileHash = createHash('sha256').update(JSON.stringify(rows)).digest('hex')

    const db = getAdminClient()

    // A re-upload opens the existing shipment instead of staging a duplicate.
    const { data: existing } = await db
      .from('shipments')
      .select('*')
      .eq('file_hash', fileHash)
      .maybeSingle()

    if (existing) {
      const { data: lines } = await db
        .from('shipment_lines')
        .select('*')
        .eq('shipment_id', existing.id)
        .order('sku')
      return NextResponse.json({
        shipment: existing,
        lines: lines ?? [],
        problems: [],
        alreadyStaged: true,
        containerWarning: await otherShipmentsForContainer(db, existing.container_ref, existing.id),
      })
    }

    let parsed
    try {
      parsed = parsePackingListSheet(rows)
    } catch (err) {
      if (err instanceof PackingListError) {
        return NextResponse.json({ error: err.message }, { status: 400 })
      }
      throw err
    }

    const grouped = groupLinesBySku(parsed.lines)

    // Resolve each SKU against the catalog so the preview can show what
    // matched before anything is registered. The UPC cross-check is the same
    // rule as the dimensions importer: a mismatch means the SKU mapping is
    // probably wrong, and this business has real barcode-collision history —
    // so the line is staged but excluded from apply, not silently trusted.
    //
    // Ask for both the sheet's casing and an upper-cased copy: the map below
    // is keyed upper-case so the comparison is case-insensitive, but Postgres
    // `in` is not, so a lower-cased SKU on the sheet (p273762 on EMCU8323054)
    // would never be fetched — the line would read as unmatched_sku, strand
    // its pieces, and be offered for creation as a duplicate product.
    const skus = grouped.map((l) => l.sku)
    const lookupSkus = [...new Set(skus.flatMap((s) => [s, s.toUpperCase()]))]
    const catalog = new Map<string, { sku: string; name: string; barcode: string | null }>()
    for (let i = 0; i < lookupSkus.length; i += 200) {
      const chunk = lookupSkus.slice(i, i + 200)
      const { data } = await db.from('products').select('sku, name, barcode').in('sku', chunk)
      for (const row of data ?? []) catalog.set(row.sku.toUpperCase(), row)
    }

    const lineRows = grouped.map((line) => {
      const product = catalog.get(line.sku.toUpperCase())
      let matchStatus: 'matched' | 'unmatched_sku' | 'barcode_mismatch' = 'matched'

      if (!product) {
        matchStatus = 'unmatched_sku'
      } else if (line.barcodeFromFile && product.barcode) {
        const sheetUpc = normalizeBarcode(line.barcodeFromFile)
        const dbBarcode = normalizeBarcode(product.barcode)
        if (sheetUpc && dbBarcode && sheetUpc !== dbBarcode) matchStatus = 'barcode_mismatch'
      }

      return {
        sku: line.sku,
        barcode_from_file: line.barcodeFromFile,
        qty_shipped: line.qtyShipped,
        qty_received: line.qtyShipped,
        match_status: matchStatus,
        // Needed by Phase 2: cartons is what reconciles a line against a
        // Commercial Invoice row, and pieces_per_case is the cs.N of a
        // generated product name. Both null on a sheet without a 箱数 column.
        cartons: line.cartons,
        pieces_per_case: line.piecesPerCase,
        case_length_in: line.caseLengthIn,
        case_width_in: line.caseWidthIn,
        case_height_in: line.caseHeightIn,
        case_weight_lb: line.caseWeightLb,
      }
    })

    const actor = await getActorEmail()
    const { data: shipment, error: shipmentError } = await db
      .from('shipments')
      .insert({
        file_name: fileName,
        file_hash: fileHash,
        container_ref: containerRef,
        line_count: lineRows.length,
        staged_by: actor,
      })
      .select('*')
      .single()

    if (shipmentError || !shipment) {
      return NextResponse.json({ error: shipmentError?.message ?? 'Failed to stage shipment.' }, { status: 400 })
    }

    const { data: insertedLines, error: linesError } = await db
      .from('shipment_lines')
      .insert(lineRows.map((l) => ({ ...l, shipment_id: shipment.id })))
      .select('*')

    if (linesError) {
      // Don't leave a shipment with no lines behind — it would occupy the
      // file_hash and block a retry of the same file.
      await db.from('shipments').delete().eq('id', shipment.id)
      return NextResponse.json({ error: linesError.message }, { status: 400 })
    }

    await logAudit({
      action: 'shipment_staged',
      entity_type: 'shipment',
      entity_id: shipment.id,
      entity_label: containerRef || fileName,
      new_value: `${lineRows.length} lines`,
      performed_by: actor,
    })

    return NextResponse.json({
      shipment,
      lines: (insertedLines ?? []).sort((a, b) => String(a.sku).localeCompare(String(b.sku))),
      problems: parsed.problems,
      unitNote: parsed.unitNote,
      containerWarning: await otherShipmentsForContainer(db, containerRef, shipment.id),
    })
  } catch (err) {
    console.error('[admin/shipments POST] error:', err)
    return NextResponse.json({ error: 'Failed to stage the packing list.' }, { status: 500 })
  }
}

// PATCH { shipment_id, lines?: [{ id, qty_received }], notes?, container_ref?, status? }
// — edit received counts before apply, or abandon the shipment.
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const shipmentId: string = typeof body.shipment_id === 'string' ? body.shipment_id : ''
    if (!shipmentId) return NextResponse.json({ error: 'Missing shipment_id' }, { status: 400 })

    const db = getAdminClient()
    const { data: shipment } = await db.from('shipments').select('*').eq('id', shipmentId).single()
    if (!shipment) return NextResponse.json({ error: 'Shipment not found.' }, { status: 404 })

    // An applied shipment is frozen: its quantities are the record of what was
    // registered in Erply, and editing them afterward would make that record
    // lie about live stock.
    if (shipment.status === 'applied') {
      return NextResponse.json(
        { error: 'This shipment has already been applied — its counts are the record of what was registered and can no longer be edited.' },
        { status: 400 },
      )
    }

    if (Array.isArray(body.lines)) {
      for (const line of body.lines) {
        const qty = Number(line?.qty_received)
        if (!Number.isInteger(qty) || qty < 0) {
          return NextResponse.json(
            { error: `Received quantity must be a whole number of 0 or more (got ${JSON.stringify(line?.qty_received)}).` },
            { status: 400 },
          )
        }
        const { error } = await db
          .from('shipment_lines')
          .update({ qty_received: qty })
          .eq('id', line.id)
          .eq('shipment_id', shipmentId)
        if (error) return NextResponse.json({ error: error.message }, { status: 400 })
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: any = {}
    if (typeof body.notes === 'string') updates.notes = body.notes.trim() || null
    if (typeof body.container_ref === 'string') updates.container_ref = body.container_ref.trim() || null
    if (body.status === 'abandoned') updates.status = 'abandoned'

    if (Object.keys(updates).length > 0) {
      const { error } = await db.from('shipments').update(updates).eq('id', shipmentId)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    }

    if (body.status === 'abandoned') {
      const actor = await getActorEmail()
      await logAudit({
        action: 'shipment_abandoned',
        entity_type: 'shipment',
        entity_id: shipmentId,
        entity_label: shipment.container_ref || shipment.file_name,
        performed_by: actor,
      })
    }

    const { data: lines } = await db
      .from('shipment_lines')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('sku')
    const { data: fresh } = await db.from('shipments').select('*').eq('id', shipmentId).single()

    return NextResponse.json({ shipment: fresh, lines: lines ?? [] })
  } catch (err) {
    console.error('[admin/shipments PATCH] error:', err)
    return NextResponse.json({ error: 'Failed to update the shipment.' }, { status: 500 })
  }
}

// DELETE ?shipment_id=… — discard a staged shipment so its file can be
// re-staged from scratch.
//
// This exists for a classification that has gone stale, not for undoing a
// receipt: `match_status` is decided once at staging, and the unique
// `file_hash` makes a re-upload reopen the same rows rather than re-resolve
// them, so a shipment staged before a matching rule changed can otherwise
// only be cleared in the SQL editor. `abandoned` doesn't release the file
// either, because the POST lookup above doesn't filter on status.
//
// The guard lives in lib/receiving.ts next to the apply/create predicates, so
// the UI and this route can't disagree about what's safe to remove.
export async function DELETE(request: NextRequest) {
  try {
    const shipmentId = request.nextUrl.searchParams.get('shipment_id')
    if (!shipmentId) return NextResponse.json({ error: 'Missing shipment_id' }, { status: 400 })

    const db = getAdminClient()
    const { data: shipment } = await db.from('shipments').select('*').eq('id', shipmentId).maybeSingle()
    if (!shipment) return NextResponse.json({ error: 'Shipment not found.' }, { status: 404 })

    const { data: lines, error: linesError } = await db
      .from('shipment_lines')
      .select('*')
      .eq('shipment_id', shipmentId)
    // Read the lines before deciding. Treating a failed read as "no lines"
    // would turn a transient error into permission to delete a shipment whose
    // stock is already in Erply.
    if (linesError) return NextResponse.json({ error: linesError.message }, { status: 400 })

    const blockers = blockersForDelete(shipment, lines ?? [])
    if (blockers.length > 0) {
      return NextResponse.json(
        {
          error:
            `This shipment can't be deleted: ${blockers.join('; ')}. ` +
            `Registering stock and creating products are one-way actions in Erply, and these rows are the record that they happened — ` +
            `deleting them would hide the receipt, not reverse it.`,
        },
        { status: 400 },
      )
    }

    // Re-check the guard inside the delete itself. Between the read above and
    // this write, an apply could have landed; `status` is what that sets, so
    // matching on it makes the delete a no-op rather than a race.
    const { data: deleted, error } = await db
      .from('shipments')
      .delete()
      .eq('id', shipmentId)
      .eq('status', shipment.status)
      .select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    if (!deleted || deleted.length === 0) {
      return NextResponse.json(
        { error: 'The shipment changed while it was being deleted — reload and check its status before retrying.' },
        { status: 409 },
      )
    }

    const actor = await getActorEmail()
    await logAudit({
      action: 'shipment_deleted',
      entity_type: 'shipment',
      entity_id: shipmentId,
      entity_label: shipment.container_ref || shipment.file_name,
      old_value: `${shipment.status}, ${lines?.length ?? 0} lines`,
      performed_by: actor,
    })

    return NextResponse.json({ ok: true, deleted_lines: lines?.length ?? 0 })
  } catch (err) {
    console.error('[admin/shipments DELETE] error:', err)
    return NextResponse.json({ error: 'Failed to delete the shipment.' }, { status: 500 })
  }
}
