import { NextRequest, NextResponse } from 'next/server'

function isMockMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return !url || url === 'your-supabase-url' || url.includes('placeholder')
}

const ALLOWED_UNIT_TYPES = ['pc', 'case', 'box', 'pack']

// POST /admin/api/products/create — add a single product manually (as
// opposed to the bulk Excel/Erply-sync paths). Same field set as the PATCH
// edit route so a manually-added product supports everything an
// imported/synced one does. NOTE: a later Excel/Erply import that matches
// this SKU will overwrite these fields, same caveat as manual edits.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const sku = typeof body.sku === 'string' ? body.sku.trim() : ''
    if (!sku) {
      return NextResponse.json({ error: 'SKU is required' }, { status: 400 })
    }
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    const priceCents = body.price_cents
    if (!Number.isInteger(priceCents) || priceCents < 0) {
      return NextResponse.json({ error: 'price_cents must be a non-negative integer' }, { status: 400 })
    }

    const stockQty = 'stock_qty' in body ? body.stock_qty : 0
    if (!Number.isInteger(stockQty) || stockQty < 0) {
      return NextResponse.json({ error: 'stock_qty must be a non-negative integer' }, { status: 400 })
    }

    const unitType = typeof body.unit_type === 'string' ? body.unit_type : 'pc'
    if (!ALLOWED_UNIT_TYPES.includes(unitType)) {
      return NextResponse.json({ error: 'unit_type must be one of: pc, case, box, pack' }, { status: 400 })
    }

    let categoryIds: string[] = []
    if ('category_ids' in body) {
      const raw = body.category_ids
      if (!Array.isArray(raw) || !raw.every((v) => typeof v === 'string' && v.trim())) {
        return NextResponse.json({ error: 'category_ids must be an array of strings' }, { status: 400 })
      }
      categoryIds = [...new Set(raw.map((v: string) => v.trim()))]
    }

    let volumeTiers: { min_qty: number; price_cents: number }[] | null = null
    if ('volume_tiers' in body && body.volume_tiers !== null) {
      const raw = body.volume_tiers
      if (!Array.isArray(raw)) {
        return NextResponse.json({ error: 'volume_tiers must be an array or null' }, { status: 400 })
      }
      const tiers = raw as { min_qty: unknown; price_cents: unknown }[]
      for (const t of tiers) {
        if (!Number.isInteger(t.min_qty) || (t.min_qty as number) < 1) {
          return NextResponse.json({ error: 'Each tier min_qty must be a positive integer' }, { status: 400 })
        }
        if (!Number.isInteger(t.price_cents) || (t.price_cents as number) < 0) {
          return NextResponse.json({ error: 'Each tier price_cents must be a non-negative integer' }, { status: 400 })
        }
      }
      volumeTiers = tiers.length > 0 ? (tiers as { min_qty: number; price_cents: number }[]) : null
    }

    let lowStockThreshold: number | null = null
    if ('low_stock_threshold' in body && body.low_stock_threshold !== null) {
      const val = body.low_stock_threshold
      if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) {
        return NextResponse.json({ error: 'low_stock_threshold must be a non-negative integer or null' }, { status: 400 })
      }
      lowStockThreshold = val
    }

    const imageUrls = Array.isArray(body.image_urls)
      ? (body.image_urls as unknown[]).filter((u) => typeof u === 'string' && u.trim() !== '').map((u) => (u as string).trim())
      : []

    if (isMockMode()) {
      return NextResponse.json({ ok: true, mock: true, id: 'prod-mock' })
    }

    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()

    const { data, error } = await db
      .from('products')
      .insert({
        sku,
        name,
        description: typeof body.description === 'string' ? body.description.trim() || null : null,
        barcode: typeof body.barcode === 'string' ? body.barcode.trim() || null : null,
        price_cents: priceCents,
        stock_qty: stockQty,
        unit_type: unitType,
        image_url: typeof body.image_url === 'string' ? body.image_url.trim() || null : null,
        image_urls: imageUrls,
        volume_tiers: volumeTiers,
        low_stock_threshold: lowStockThreshold,
        category_id: categoryIds[0] ?? null,
      })
      .select('id')
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: `SKU "${sku}" already exists` }, { status: 409 })
      }
      throw error
    }

    // A DB trigger already mirrors category_id (categoryIds[0], just written
    // above) into product_categories on insert -- only insert any *additional*
    // selected categories here, or this collides with what the trigger just
    // wrote and fails on the unique constraint.
    const extraCategoryIds = categoryIds.slice(1)
    if (extraCategoryIds.length > 0) {
      const { error: catError } = await db
        .from('product_categories')
        .insert(extraCategoryIds.map((categoryId) => ({ product_id: data.id, category_id: categoryId })))
      if (catError) throw catError
    }

    return NextResponse.json({ ok: true, id: data.id })
  } catch (err) {
    console.error('[admin/products/create POST] error:', err)
    return NextResponse.json({ error: 'Failed to create product' }, { status: 500 })
  }
}
