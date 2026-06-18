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

// PATCH /admin/api/products — toggle a single product's visibility
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const id: string = body.id
    const manually_hidden: boolean = body.manually_hidden

    if (isMockMode()) {
      return NextResponse.json({ ok: true, mock: true })
    }

    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()

    const { error } = await db
      .from('products')
      .update({ manually_hidden, updated_at: new Date().toISOString() })
      .eq('id', id)
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
