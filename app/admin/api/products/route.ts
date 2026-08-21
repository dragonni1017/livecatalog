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
    if ('category_id' in body) {
      const val = body.category_id
      if (val === null) {
        updates.category_id = null
      } else if (typeof val === 'string' && val.trim()) {
        updates.category_id = val.trim()
      } else {
        return NextResponse.json({ error: 'category_id must be a string or null' }, { status: 400 })
      }
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

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/products PATCH] error:', err)
    return NextResponse.json({ error: 'Failed to update product' }, { status: 500 })
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
