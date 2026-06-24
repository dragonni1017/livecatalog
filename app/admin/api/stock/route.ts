import { NextRequest, NextResponse } from 'next/server'

function isMockMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return !url || url === 'your-supabase-url' || url.includes('placeholder')
}

// GET /admin/api/stock?product_id=... — recent manual adjustment history for one product
export async function GET(request: NextRequest) {
  try {
    const productId = request.nextUrl.searchParams.get('product_id')
    if (!productId) {
      return NextResponse.json({ error: 'Missing product_id' }, { status: 400 })
    }

    if (isMockMode()) {
      return NextResponse.json({ ok: true, mock: true, adjustments: [] })
    }

    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()

    const { data, error } = await db
      .from('stock_adjustments')
      .select('id, delta, previous_qty, new_qty, reason, changed_by_email, created_at')
      .eq('product_id', productId)
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) throw error

    return NextResponse.json({ adjustments: data ?? [] })
  } catch (err) {
    console.error('[admin/stock GET] error:', err)
    return NextResponse.json({ error: 'Failed to load stock history' }, { status: 500 })
  }
}

// POST /admin/api/stock — apply a manual +/- adjustment to a product's stock_qty.
// Access is gated by the shared-password admin cookie (enforced by middleware on
// every /admin/* route); every change is logged to stock_adjustments for an
// audit trail, attributed to the generic "admin" since there are no per-user
// logins.
//
// NOTE: like other manual product edits in this app, this is a between-imports
// override — the next Excel/Erply sync sets stock_qty from the source of truth
// again, the same caveat that already applies to inline name/description edits.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const productId: string = body.product_id
    const delta = Number(body.delta)
    const reason: string | null = typeof body.reason === 'string' ? body.reason.trim() || null : null

    if (!productId) {
      return NextResponse.json({ error: 'Missing product_id' }, { status: 400 })
    }
    if (!Number.isInteger(delta) || delta === 0) {
      return NextResponse.json({ error: 'delta must be a non-zero whole number' }, { status: 400 })
    }

    if (isMockMode()) {
      return NextResponse.json({ ok: true, mock: true, new_qty: 0 })
    }

    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()

    const { data: product, error: fetchError } = await db
      .from('products')
      .select('id, sku, name, stock_qty')
      .eq('id', productId)
      .single()
    if (fetchError || !product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    const previousQty: number = product.stock_qty
    const newQty = previousQty + delta
    if (newQty < 0) {
      return NextResponse.json(
        { error: `Can't remove ${Math.abs(delta)} — only ${previousQty} in stock.` },
        { status: 400 }
      )
    }

    const { error: updateError } = await db
      .from('products')
      .update({ stock_qty: newQty, updated_at: new Date().toISOString() })
      .eq('id', productId)
    if (updateError) throw updateError

    const { error: logError } = await db.from('stock_adjustments').insert({
      product_id: productId,
      sku: product.sku,
      product_name: product.name,
      delta,
      previous_qty: previousQty,
      new_qty: newQty,
      reason,
      changed_by_user_id: null,
      changed_by_email: 'admin',
    })
    if (logError) {
      // The stock change already succeeded — don't fail the request over a
      // logging error, but make sure it's visible in the server logs.
      console.error('[admin/stock POST] failed to log adjustment:', logError)
    }

    // Best-effort — mirrors the same check that runs after Excel/Erply syncs,
    // so a manual adjustment that crosses the threshold also alerts.
    try {
      const { checkLowStockAndNotify } = await import('@/lib/low-stock-alert')
      await checkLowStockAndNotify(db)
    } catch (err) {
      console.error('[admin/stock POST] low-stock check failed:', err)
    }

    return NextResponse.json({ ok: true, previous_qty: previousQty, new_qty: newQty })
  } catch (err) {
    console.error('[admin/stock POST] error:', err)
    return NextResponse.json({ error: 'Failed to adjust stock' }, { status: 500 })
  }
}
