import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { getActorEmail } from '@/lib/auth-server'
import { logAudit } from '@/lib/audit'
import {
  getErplyProductByCode,
  getErplyStockIndex,
  isConfigured as isErplyConfigured,
} from '@/lib/erply'
import { resolveErplyCategoryAlias } from '@/lib/erply-category-aliases'

export const dynamic = 'force-dynamic'

// POST { shipment_id } — mirror this shipment's newly created Erply products
// into the catalog.
//
// Receiving creates products in ERPLY. Nothing puts them in the catalog: the
// Erply -> Supabase sync does it eventually, but that runs on a cron which is
// disabled in production for want of credentials, so in practice it meant
// remembering to run a script. Three script steps for a finished container
// (catalog, photos, sync) is three chances to forget one, and a product that
// exists in Erply but not the catalog is invisible with no sign anything is
// wrong.
//
// Deliberately NOT automatic on create: this writes rows to the live catalog,
// which is a decision worth making rather than a side effect of a different
// button.
//
// Ported from scripts/push-receiving-products-to-supabase.ts, which stays as
// the way to do this for a shipment the screen cannot reach.

const WAREHOUSE_ID = 1

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const shipmentId: string = typeof body.shipment_id === 'string' ? body.shipment_id : ''
    if (!shipmentId) return NextResponse.json({ error: 'Missing shipment_id' }, { status: 400 })

    if (!isErplyConfigured()) {
      return NextResponse.json(
        {
          error:
            'Erply is not configured in this environment, so the products cannot be read back. Nothing was changed.',
        },
        { status: 503 },
      )
    }

    const db = getAdminClient()
    const { data: lines } = await db
      .from('shipment_lines')
      .select('sku, erply_created_product_id')
      .eq('shipment_id', shipmentId)
      .not('erply_created_product_id', 'is', null)

    const createdSkus = [...new Set((lines ?? []).map((l) => String(l.sku)))]
    if (createdSkus.length === 0) {
      return NextResponse.json({ error: 'This shipment created no products in Erply.' }, { status: 400 })
    }

    // Which are already in the catalog?
    const present = new Set<string>()
    for (let i = 0; i < createdSkus.length; i += 200) {
      const { data } = await db.from('products').select('sku').in('sku', createdSkus.slice(i, i + 200))
      for (const p of data ?? []) present.add(p.sku.toUpperCase())
    }
    const missing = createdSkus.filter((s) => !present.has(s.toUpperCase()))
    if (missing.length === 0) {
      return NextResponse.json({ ok: true, inserted: 0, note: 'Every product from this shipment is already in the catalog.' })
    }

    // Erply is the authority on name, group, barcode, price and stock -- the
    // staged line is not trusted for any of them.
    const stockIndex = await getErplyStockIndex(WAREHOUSE_ID)
    const { data: catRows } = await db.from('categories').select('id, name')
    const catIdByName = new Map((catRows ?? []).map((c) => [c.name.toLowerCase(), c.id]))

    // ids are assigned here rather than left to the column default: that
    // default draws from products_id_seq, which has collided with
    // hand-assigned prod-NNNNN blocks before and takes a whole 500-row chunk
    // down with it (see supabase/migrations/0052).
    const allIds: string[] = []
    for (let from = 0; ; from += 1000) {
      const { data } = await db.from('products').select('id').range(from, from + 999)
      allIds.push(...(data ?? []).map((p) => p.id as string))
      if ((data ?? []).length < 1000) break
    }
    let nextId =
      allIds.reduce((max, id) => {
        const m = /^prod-(\d+)$/.exec(id)
        return m ? Math.max(max, parseInt(m[1], 10)) : max
      }, 0) + 1

    const rows: Record<string, unknown>[] = []
    const skippedPriced: string[] = []
    const notInErply: string[] = []
    const noCategory: string[] = []

    for (const sku of missing) {
      const e = await getErplyProductByCode(sku)
      if (!e) { notInErply.push(sku); continue }
      // A priced product belongs to the normal sync, which owns the pricing
      // formula (roundToQuarterSkip75 x RETAIL_MULTIPLIER). This route
      // deliberately contains no pricing logic to duplicate.
      if (e.price > 0) { skippedPriced.push(sku); continue }

      const categoryName = resolveErplyCategoryAlias(e.groupName)
      const categoryId = catIdByName.get(categoryName.toLowerCase()) ?? null
      if (!categoryId) noCategory.push(sku)

      rows.push({
        id: `prod-${String(nextId++).padStart(5, '0')}`,
        sku,
        barcode: e.barcode,
        name: e.name,
        description: null,
        price_cents: 0,
        stock_qty: stockIndex.get(sku.toUpperCase())?.stockQty ?? 0,
        is_active: e.isActive,
        // Priced at 0, so hidden: lib/order-submission.ts checks only
        // is_active/manually_hidden, and a visible $0 product is orderable.
        manually_hidden: true,
        needs_photo: true,
        category_id: categoryId,
        image_url: null,
        image_urls: [],
      })
    }

    let inserted = 0
    const failures: string[] = []
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100)
      const { error } = await db.from('products').insert(chunk)
      if (error) failures.push(error.message)
      else inserted += chunk.length
    }

    if (inserted > 0) {
      await logAudit({
        action: 'shipment_products_to_catalog',
        entity_type: 'shipment',
        entity_id: shipmentId,
        new_value: `${inserted} product(s) added to the catalog, hidden pending pricing`,
        performed_by: await getActorEmail(),
      })
    }

    return NextResponse.json({
      ok: failures.length === 0,
      inserted,
      hidden: inserted,
      skippedPriced,
      notInErply,
      noCategory,
      failures,
      // Said plainly because it is the next question: they are in the catalog
      // but nobody can see them until a price exists in Erply.
      note:
        inserted > 0
          ? `${inserted} product(s) added, hidden until they are priced in Erply.`
          : 'Nothing was added.',
    })
  } catch (err) {
    console.error('[admin/shipments/to-catalog] error:', err)
    return NextResponse.json({ error: 'Failed to add the products to the catalog.' }, { status: 500 })
  }
}
