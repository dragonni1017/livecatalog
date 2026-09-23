import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { getActorEmail } from '@/lib/auth-server'
import { logAudit } from '@/lib/audit'
import {
  CommercialInvoiceError,
  joinInvoiceToLines,
  parseCommercialInvoiceSheet,
  proposeDescriptor,
} from '@/lib/commercial-invoice'
import type { SheetRow } from '@/lib/packing-list'
import { isCreatable } from '@/lib/receiving'
import {
  createErplyProduct,
  ErplyApiError,
  getErplyProductByBarcode,
  getErplyProductByCode,
  getErplyProductGroups,
  isConfigured as isErplyConfigured,
} from '@/lib/erply'

export const dynamic = 'force-dynamic'

/**
 * Turn a failed create into something the warehouse can act on.
 *
 * Erply's uniqueness rejection (1012) names only the field, so the two cases
 * that actually happen here are indistinguishable from the raw message even
 * though they need opposite responses:
 *
 *  - the SKU exists    -> nothing to do, this product is already in Erply
 *  - the barcode exists -> the file disagrees with itself (or with Erply),
 *                          and a human has to decide which barcode is right
 *
 * Both are worth a lookup, because naming the other product is what makes the
 * message actionable. A failed lookup must never mask the original error, so
 * every one of them is best-effort.
 */
async function explainCreateFailure(
  err: unknown,
  line: { sku: string; barcode_from_file: string | null },
): Promise<string> {
  const message = err instanceof Error ? err.message : String(err)
  if (!(err instanceof ErplyApiError) || err.errorCode !== 1012) return message

  if (err.errorField === 'code') {
    try {
      const existing = await getErplyProductByCode(line.sku)
      if (existing) {
        return `${line.sku} already exists in Erply (productID ${existing.productId}, "${existing.name}"), so nothing was created. This usually means the SKU arrived on an earlier container. [Erply 1012/code]`
      }
    } catch { /* fall through to the generic message */ }
    return `${line.sku} already exists in Erply, so nothing was created. [Erply 1012/code]`
  }

  if (err.errorField === 'code2') {
    const barcode = line.barcode_from_file ?? err.rejectedValue
    let holder = ''
    try {
      const owner = barcode ? await getErplyProductByBarcode(barcode) : null
      if (owner) holder = ` It is already on ${owner.sku} ("${owner.name}").`
    } catch { /* best effort -- the advice below stands either way */ }
    return `Barcode ${barcode ?? '(unknown)'} is already used by another product, and Erply requires barcodes to be unique.${holder} Either correct this line's barcode, or clear it and create the product without one. [Erply 1012/code2]`
  }

  return message
}

// Phase 2 of receiving: turn a shipment's unmatched SKUs into real Erply
// products. Three verbs, deliberately separate:
//
//   PUT   — attach a Commercial Invoice and generate name proposals
//   PATCH — save the admin's edits to those proposals
//   POST  — create the approved ones in Erply (the one-way action)
//
// Nothing here writes to `products`: Erply is the master for name, price and
// category (lib/product-sync.ts overwrites all three on every sync), so a new
// product is born in Erply and arrives in the catalog on the next sync.

// PUT { shipment_id, rows } — parse the invoice workbook and propose names.
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()
    const shipmentId: string = typeof body.shipment_id === 'string' ? body.shipment_id : ''
    const rows: SheetRow[] = Array.isArray(body.rows) ? body.rows : []
    if (!shipmentId) return NextResponse.json({ error: 'Missing shipment_id' }, { status: 400 })
    if (rows.length === 0) return NextResponse.json({ error: 'The invoice sheet had no rows.' }, { status: 400 })

    const db = getAdminClient()
    const { data: shipment } = await db.from('shipments').select('*').eq('id', shipmentId).single()
    if (!shipment) return NextResponse.json({ error: 'Shipment not found.' }, { status: 404 })

    let invoice
    try {
      invoice = parseCommercialInvoiceSheet(rows)
    } catch (err) {
      if (err instanceof CommercialInvoiceError) {
        return NextResponse.json({ error: err.message }, { status: 400 })
      }
      throw err
    }

    const { data: lines } = await db.from('shipment_lines').select('*').eq('shipment_id', shipmentId).order('sku')
    const all = lines ?? []

    // Join across EVERY line, not just the unmatched ones: a colourway family
    // often mixes SKUs the catalog already knows with new ones, and dropping
    // the known members would break the carton/piece sums the join relies on.
    const joined = joinInvoiceToLines(
      invoice.lines,
      all.map((l) => ({ sku: l.sku, qtyShipped: l.qty_shipped, cartons: l.cartons ?? null })),
    )
    const bySku = new Map(joined.map((j) => [j.sku, j]))

    let proposed = 0
    for (const line of all) {
      const join = bySku.get(line.sku)
      if (!join) continue

      // Only the not-yet-created lines get a proposal; a created one is a
      // historical record.
      const updates: Record<string, unknown> = {
        invoice_line_no: join.invoiceLineNo,
        invoice_description: join.description,
        invoice_unit_price_cents:
          join.unitPriceUsd != null ? Math.round(join.unitPriceUsd * 100) : null,
        invoice_match_basis: join.basis === 'none' ? null : join.basis,
      }

      // Only a genuinely new SKU gets a name proposal. A barcode_mismatch
      // line is not creatable — the SKU already exists and only its UPC
      // disagrees — so proposing a name there would imply an action the
      // create step refuses. An ambiguous match carries candidate text
      // rather than a description, so it must never seed a name either.
      if (isCreatable(line) && join.basis !== 'ambiguous') {
        const descriptor = proposeDescriptor(join.description, line.sku)
        // Descriptor only — no pack spec. The sheet gives pieces per case but
        // never how those pieces are packed, and a name asserting "12/pk"
        // when nobody checked would be a fact invented by software. The UI
        // appends the spec once the admin supplies pieces-per-pack.
        if (descriptor && line.proposed_name == null) {
          updates.proposed_name = descriptor
          proposed++
        }
      }

      await db.from('shipment_lines').update(updates).eq('id', line.id)
    }

    const { data: fresh } = await db.from('shipment_lines').select('*').eq('shipment_id', shipmentId).order('sku')

    return NextResponse.json({
      lines: fresh ?? [],
      invoiceLines: invoice.lines.length,
      totalCartons: invoice.totalCartons,
      totalPieces: invoice.totalPieces,
      matched: joined.filter((j) => j.basis !== 'none').length,
      proposed,
    })
  } catch (err) {
    console.error('[admin/shipments/new-products PUT] error:', err)
    return NextResponse.json({ error: 'Failed to read the commercial invoice.' }, { status: 500 })
  }
}

// PATCH { lines: [{ id, proposed_name?, proposed_category?, proposed_price_cents?, proposed_pieces_per_pack? }] }
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      return NextResponse.json({ error: 'No lines to update.' }, { status: 400 })
    }

    const db = getAdminClient()
    for (const line of body.lines) {
      if (typeof line?.id !== 'string') continue

      const updates: Record<string, unknown> = {}
      if (typeof line.proposed_name === 'string') updates.proposed_name = line.proposed_name.trim() || null
      if (typeof line.proposed_category === 'string') updates.proposed_category = line.proposed_category.trim() || null

      if (line.proposed_price_cents != null) {
        const cents = Number(line.proposed_price_cents)
        if (!Number.isInteger(cents) || cents < 0) {
          return NextResponse.json({ error: 'Price must be a whole number of cents, 0 or more.' }, { status: 400 })
        }
        updates.proposed_price_cents = cents
      }

      if (line.proposed_pieces_per_pack != null) {
        const pk = Number(line.proposed_pieces_per_pack)
        if (!Number.isInteger(pk) || pk <= 0) {
          return NextResponse.json({ error: 'Pieces per pack must be a whole number above 0.' }, { status: 400 })
        }
        updates.proposed_pieces_per_pack = pk
      }

      if (Object.keys(updates).length === 0) continue

      const { error } = await db.from('shipment_lines').update(updates).eq('id', line.id).is('erply_created_product_id', null)
      if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/shipments/new-products PATCH] error:', err)
    return NextResponse.json({ error: 'Failed to save the proposals.' }, { status: 500 })
  }
}

// POST { shipment_id, line_ids } — create the approved products in Erply.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const shipmentId: string = typeof body.shipment_id === 'string' ? body.shipment_id : ''
    const lineIds: string[] = Array.isArray(body.line_ids) ? body.line_ids.filter((v: unknown) => typeof v === 'string') : []
    if (!shipmentId) return NextResponse.json({ error: 'Missing shipment_id' }, { status: 400 })
    if (lineIds.length === 0) return NextResponse.json({ error: 'Select at least one product to create.' }, { status: 400 })

    if (!isErplyConfigured()) {
      return NextResponse.json(
        {
          error:
            'Erply is not configured in this environment, so no product can be created. Nothing was changed. Create from an environment that has the Erply credentials.',
        },
        { status: 503 },
      )
    }

    const db = getAdminClient()
    const { data: lines } = await db
      .from('shipment_lines')
      .select('*')
      .eq('shipment_id', shipmentId)
      .in('id', lineIds)

    // isCreatable also excludes barcode_mismatch, which used to slip through:
    // that status means the SKU IS already in the catalog and only its UPC
    // disagrees, so "creating" it would ask Erply for a duplicate code or
    // produce a second product for the same item.
    const eligible = (lines ?? []).filter(isCreatable)
    if (eligible.length === 0) {
      const alreadyCreated = (lines ?? []).filter((l) => l.erply_created_product_id).length
      const mismatched = (lines ?? []).filter((l) => l.match_status === 'barcode_mismatch').length
      return NextResponse.json(
        {
          error: alreadyCreated
            ? 'Every selected line already has a product in Erply.'
            : mismatched
              ? 'Those lines have a UPC that disagrees with the barcode on file, so the SKU already exists in the catalog. Resolve the barcode before creating anything.'
              : 'None of the selected lines are new SKUs.',
        },
        { status: 400 },
      )
    }

    // Validate the whole batch before creating anything: a product created in
    // Erply cannot be un-created from this repo, so a batch that would fail
    // halfway should not start.
    const groups = await getErplyProductGroups()
    if (groups.length === 0) {
      return NextResponse.json({ error: 'Erply returned no product groups, so no category could be resolved. Nothing was changed.' }, { status: 502 })
    }
    const groupByName = new Map(groups.map((g) => [g.name.toLowerCase(), g]))

    const problems: string[] = []
    for (const line of eligible) {
      if (!line.proposed_name) problems.push(`${line.sku}: no name`)
      if (!line.proposed_category) problems.push(`${line.sku}: no category`)
      else if (!groupByName.has(String(line.proposed_category).toLowerCase())) {
        problems.push(`${line.sku}: category "${line.proposed_category}" is not an Erply product group`)
      }
      if (line.proposed_price_cents == null) problems.push(`${line.sku}: no price`)
    }
    if (problems.length > 0) {
      return NextResponse.json(
        { error: `Nothing was created — fix these first:\n${problems.join('\n')}` },
        { status: 400 },
      )
    }

    const actor = await getActorEmail()
    const created: Array<{ sku: string; productId: number }> = []
    const priceWarnings: Array<{ sku: string; stored: number; wanted: number }> = []
    const failed: Array<{ sku: string; error: string }> = []

    for (const line of eligible) {
      const group = groupByName.get(String(line.proposed_category).toLowerCase())!
      try {
        const { productId } = await createErplyProduct({
          sku: line.sku,
          name: line.proposed_name,
          barcode: line.barcode_from_file,
          groupId: group.id,
          priceDollars: line.proposed_price_cents / 100,
        })
        // Read the product back before declaring success. Erply's saveProduct
        // accepted a price and stored 0 when this was tested on 2026-09-16
        // (test product ZZTESTCLAUDE0916), so a create that "worked" can still
        // leave a $0.00 product — which, once it syncs, is a sellable free
        // product. The warning is persisted on the line, not just returned,
        // so it survives a page reload.
        let priceWarning: string | null = null
        try {
          const readBack = await getErplyProductByCode(line.sku)
          const wanted = line.proposed_price_cents / 100
          if (readBack && Math.abs((readBack.price ?? 0) - wanted) > 0.005) {
            priceWarning =
              `WARNING: created, but Erply stored a price of ${(readBack.price ?? 0).toFixed(2)} instead of ${wanted.toFixed(2)}. ` +
              `Set this product's price in Erply by hand before it goes on sale.`
            priceWarnings.push({ sku: line.sku, stored: readBack.price ?? 0, wanted })
          }
        } catch {
          // A failed read-back must not make a successful create look failed.
          priceWarning = 'WARNING: created, but the price could not be verified — check it in Erply.'
        }

        // Recorded immediately, per line: if the next one throws, this SKU
        // must never be offered for creation again.
        //
        // match_status flips to 'matched' because the SKU now genuinely does
        // exist in Erply — and that is what makes its stock appliable in the
        // same pass. Without it the classification stayed 'unmatched_sku'
        // forever, the apply step skipped the line, and a container's new
        // products landed in the catalog with their received pieces stranded;
        // re-uploading the workbook didn't help either, since the unique
        // file_hash just reopens the same shipment with the same stale
        // classification. Only lines that were 'unmatched_sku' reach here
        // (see isCreatable), so this can't quietly clear a barcode mismatch.
        await db
          .from('shipment_lines')
          .update({
            erply_created_product_id: productId,
            created_product_at: new Date().toISOString(),
            create_error: priceWarning,
            match_status: 'matched',
          })
          .eq('id', line.id)
        created.push({ sku: line.sku, productId })
      } catch (err) {
        const message = await explainCreateFailure(err, line)
        await db.from('shipment_lines').update({ create_error: message }).eq('id', line.id)
        failed.push({ sku: line.sku, error: message })
      }
    }

    if (created.length > 0) {
      await logAudit({
        action: 'shipment_products_created',
        entity_type: 'shipment',
        entity_id: shipmentId,
        entity_label: created.map((c) => c.sku).join(', ').slice(0, 200),
        new_value: `${created.length} product(s) created in Erply`,
        performed_by: actor,
      })
    }

    const { data: fresh } = await db.from('shipment_lines').select('*').eq('shipment_id', shipmentId).order('sku')

    return NextResponse.json({
      lines: fresh ?? [],
      created,
      failed,
      priceWarnings,
      note:
        'Created in Erply. They appear in the catalog after the next Erply sync, and their stock still has to be applied from the Receiving tab.',
    })
  } catch (err) {
    console.error('[admin/shipments/new-products POST] error:', err)
    return NextResponse.json({ error: 'Failed to create the products.' }, { status: 500 })
  }
}

// GET ?shipment_id= — the Erply product groups, for the category picker.
export async function GET() {
  try {
    const groups = await getErplyProductGroups()
    return NextResponse.json({ groups })
  } catch (err) {
    console.error('[admin/shipments/new-products GET] error:', err)
    return NextResponse.json({ groups: [] })
  }
}
