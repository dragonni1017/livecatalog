import { NextRequest, NextResponse } from 'next/server'

function isMockMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return !url || url === 'your-supabase-url' || url.includes('placeholder')
}

const PRODUCT_COLUMNS = 'id, sku, name, image_url, is_active, manually_hidden'

// GET /admin/api/products?q=term — list products for the admin table
export async function GET(request: NextRequest) {
  try {
    if (isMockMode()) {
      return NextResponse.json({ ok: true, mock: true, products: [] })
    }

    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()

    const q = request.nextUrl.searchParams.get('q')?.trim()

    let query = db.from('products').select(PRODUCT_COLUMNS)

    if (q) {
      query = query.or(`name.ilike.%${q}%,sku.ilike.%${q}%`)
    }

    const { data, error } = await query.order('name')
    if (error) throw error

    return NextResponse.json({ products: data ?? [] })
  } catch (err) {
    console.error('[admin/products GET] error:', err)
    return NextResponse.json({ error: 'Failed to load products' }, { status: 500 })
  }
}

// PATCH /admin/api/products — update a single product.
// Accepts any subset of: manually_hidden (visibility toggle), name, description,
// image_url (inline edit). Only the provided fields are written.
// NOTE: these write directly to products, so a later Excel/Erply re-import (which
// upserts by SKU) will overwrite them — this is a between-imports override.
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const id: string = body.id
    if (!id) {
      return NextResponse.json({ error: 'Missing product id' }, { status: 400 })
    }

    // Build the update from only the fields actually provided.
    const updates: Record<string, unknown> = {}
    if (typeof body.manually_hidden === 'boolean') updates.manually_hidden = body.manually_hidden
    if (typeof body.name === 'string') {
      const name = body.name.trim()
      if (!name) return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
      updates.name = name
    }
    if (typeof body.description === 'string') updates.description = body.description.trim() || null
    if (typeof body.image_url === 'string') updates.image_url = body.image_url.trim() || null
    if ('price_cents' in body) {
      const val = body.price_cents
      if (!Number.isInteger(val) || (val as number) < 0) {
        return NextResponse.json({ error: 'price_cents must be a non-negative integer' }, { status: 400 })
      }
      updates.price_cents = val
    }
    if ('unit_type' in body) {
      const val = body.unit_type
      const ALLOWED_UNIT_TYPES = ['pc', 'case', 'box', 'pack']
      if (typeof val !== 'string' || !ALLOWED_UNIT_TYPES.includes(val)) {
        return NextResponse.json({ error: 'unit_type must be one of: pc, case, box, pack' }, { status: 400 })
      }
      updates.unit_type = val
    }
    if ('image_urls' in body) {
      const raw = body.image_urls
      if (!Array.isArray(raw)) {
        return NextResponse.json({ error: 'image_urls must be an array' }, { status: 400 })
      }
      const cleaned = (raw as unknown[])
        .filter((u) => typeof u === 'string' && u.trim() !== '')
        .map((u) => (u as string).trim())
      updates.image_urls = cleaned
    }
    if ('volume_tiers' in body) {
      const raw = body.volume_tiers
      if (raw === null) {
        updates.volume_tiers = null
      } else if (Array.isArray(raw)) {
        const tiers = raw as { min_qty: unknown; price_cents: unknown }[]
        for (const t of tiers) {
          if (!Number.isInteger(t.min_qty) || (t.min_qty as number) < 1) {
            return NextResponse.json({ error: 'Each tier min_qty must be a positive integer' }, { status: 400 })
          }
          if (!Number.isInteger(t.price_cents) || (t.price_cents as number) < 0) {
            return NextResponse.json({ error: 'Each tier price_cents must be a non-negative integer' }, { status: 400 })
          }
        }
        updates.volume_tiers = tiers.length > 0 ? tiers : null
      } else {
        return NextResponse.json({ error: 'volume_tiers must be an array or null' }, { status: 400 })
      }
    }
    // category_ids replaces the product's full category set (a product can
    // now belong to more than one -- see product_categories, migration
    // 0038). products.category_id is kept in sync as the first of the
    // selected categories, "primary" -- Erply sync / Excel import still
    // read/write only that single column and never touch product_categories
    // on update, so this is the one write path responsible for keeping both
    // in agreement once an admin edits a product's categories.
    let newCategoryIds: string[] | null = null
    if ('category_ids' in body) {
      const raw = body.category_ids
      if (!Array.isArray(raw) || !raw.every((v) => typeof v === 'string' && v.trim())) {
        return NextResponse.json({ error: 'category_ids must be an array of strings' }, { status: 400 })
      }
      newCategoryIds = [...new Set(raw.map((v) => v.trim()))]
      updates.category_id = newCategoryIds[0] ?? null
    }
    if ('low_stock_threshold' in body) {
      const val = body.low_stock_threshold
      if (val === null) {
        updates.low_stock_threshold = null
      } else if (typeof val === 'number' && Number.isInteger(val) && val >= 0) {
        updates.low_stock_threshold = val
      } else {
        return NextResponse.json({ error: 'low_stock_threshold must be a non-negative integer or null' }, { status: 400 })
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    if (isMockMode()) {
      return NextResponse.json({ ok: true, mock: true })
    }

    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()

    updates.updated_at = new Date().toISOString()
    const { error } = await db.from('products').update(updates).eq('id', id)
    if (error) throw error

    if (newCategoryIds !== null) {
      const { error: deleteError } = await db.from('product_categories').delete().eq('product_id', id)
      if (deleteError) throw deleteError
      if (newCategoryIds.length > 0) {
        const { error: insertError } = await db
          .from('product_categories')
          .insert(newCategoryIds.map((categoryId) => ({ product_id: id, category_id: categoryId })))
        if (insertError) throw insertError
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/products PATCH] error:', err)
    return NextResponse.json({ error: 'Failed to update product' }, { status: 500 })
  }
}

// DELETE /admin/api/products?id=... — permanently remove a product.
// Safe by schema design: product_categories/back_in_stock rows cascade-delete,
// while order_items/stock_adjustments/analytics_events just set product_id to
// null (order/stock history is preserved, only the dead product link goes).
// NOTE: if this product still exists in Erply or the Excel import source, the
// next sync/import will simply re-create it (upsert by SKU) -- this only
// removes it here in between syncs, same caveat as the existing edit/hide
// actions on this route.
export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'Missing product id' }, { status: 400 })
    }

    if (isMockMode()) {
      return NextResponse.json({ ok: true, mock: true })
    }

    const { getAdminClient } = await import('@/lib/supabase')
    const { logAudit } = await import('@/lib/audit')
    const db = getAdminClient()

    const { data: product } = await db.from('products').select('name, sku').eq('id', id).maybeSingle()
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    const { error } = await db.from('products').delete().eq('id', id)
    if (error) throw error

    await logAudit({
      action: 'product_deleted',
      entity_type: 'product',
      entity_id: id,
      entity_label: product.sku ? `${product.name} (${product.sku})` : product.name,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/products DELETE] error:', err)
    return NextResponse.json({ error: 'Failed to delete product' }, { status: 500 })
  }
}

// POST /admin/api/products — bulk visibility actions
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const action: 'hide_imageless' | 'unhide_with_image' = body.action

    if (isMockMode()) {
      return NextResponse.json({ ok: true, mock: true, affected: 0 })
    }

    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()

    if (action === 'hide_imageless') {
      const { data, error } = await db
        .from('products')
        .update({ manually_hidden: true, updated_at: new Date().toISOString() })
        .or('image_url.is.null,image_url.eq.')
        .select('id')
      if (error) throw error
      return NextResponse.json({ ok: true, affected: data?.length ?? 0 })
    }

    if (action === 'unhide_with_image') {
      const { data, error } = await db
        .from('products')
        .update({ manually_hidden: false, updated_at: new Date().toISOString() })
        .not('image_url', 'is', null)
        .neq('image_url', '')
        .eq('manually_hidden', true)
        .select('id')
      if (error) throw error
      return NextResponse.json({ ok: true, affected: data?.length ?? 0 })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    console.error('[admin/products POST] error:', err)
    return NextResponse.json({ error: 'Bulk action failed' }, { status: 500 })
  }
}
