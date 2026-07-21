import { NextRequest, NextResponse } from 'next/server'

function isMockMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return !url || url === 'your-supabase-url' || url.includes('placeholder')
}

// POST /admin/api/stock/bulk — apply a stock adjustment to multiple products at once.
// Body: { ids: string[], adjustment: number, mode: 'set' | 'adjust' }
//   mode 'set'    → stock_qty = adjustment for all ids
//   mode 'adjust' → stock_qty = max(stock_qty + adjustment, 0) for all ids
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { ids, adjustment, mode } = body

    // Validate ids
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'ids must be a non-empty array' }, { status: 400 })
    }
    if (!ids.every((id) => typeof id === 'string' && id.length > 0)) {
      return NextResponse.json({ error: 'ids must be an array of strings' }, { status: 400 })
    }

    // Validate adjustment
    const adj = Number(adjustment)
    if (!Number.isInteger(adj)) {
      return NextResponse.json({ error: 'adjustment must be an integer' }, { status: 400 })
    }

    // Validate mode
    if (mode !== 'set' && mode !== 'adjust') {
      return NextResponse.json({ error: 'mode must be "set" or "adjust"' }, { status: 400 })
    }

    if (isMockMode()) {
      return NextResponse.json({ ok: true, mock: true, updated: ids.length })
    }

    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()

    // Need sku + current stock_qty per product: adjust_stock() (migration 0018)
    // takes a signed delta and a sku, not a product id or an absolute value.
    const { data: products, error: fetchError } = await db
      .from('products')
      .select('id, sku, stock_qty')
      .in('id', ids)
    if (fetchError) throw fetchError

    let updated = 0
    const failedSkus: string[] = []
    const reason = mode === 'set' ? 'bulk set' : 'bulk adjust'

    for (const p of products ?? []) {
      // 'set' mode: turn the target absolute qty into a delta against current
      // stock so it still goes through adjust_stock() as a delta + audit row
      // instead of a silent overwrite. 'adjust' mode: delta is the adjustment
      // itself. Either way, adjust_stock() clamps the result at 0 and skips
      // logging a zero-delta row.
      const delta = mode === 'set' ? adj - (p.stock_qty as number) : adj
      if (delta === 0) continue

      const { error: rpcError } = await db.rpc('adjust_stock', {
        p_sku: p.sku,
        p_delta: delta,
        p_reason: reason,
        p_changed_by_email: 'admin',
      })
      if (rpcError) {
        console.error('[admin/stock/bulk POST] adjust_stock failed for', p.sku, rpcError)
        failedSkus.push(p.sku as string)
        continue
      }
      updated++
    }

    // Best-effort — mirrors the check that runs after a single adjustment.
    try {
      const { checkLowStockAndNotify } = await import('@/lib/low-stock-alert')
      await checkLowStockAndNotify(db)
    } catch (err) {
      console.error('[admin/stock/bulk POST] low-stock check failed:', err)
    }

    return NextResponse.json({
      ok: true,
      updated,
      ...(failedSkus.length > 0 ? { failed: failedSkus } : {}),
    })
  } catch (err) {
    console.error('[admin/stock/bulk POST] error:', err)
    return NextResponse.json({ error: 'Failed to update stock' }, { status: 500 })
  }
}
