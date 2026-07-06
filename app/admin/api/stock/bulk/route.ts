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

    if (mode === 'set') {
      const { error } = await db
        .from('products')
        .update({ stock_qty: adj, updated_at: new Date().toISOString() })
        .in('id', ids)
      if (error) throw error
    } else {
      // 'adjust' mode: update each product individually so we can clamp to 0
      for (const id of ids) {
        const { data: product, error: fetchError } = await db
          .from('products')
          .select('stock_qty')
          .eq('id', id)
          .single()
        if (fetchError || !product) continue

        const newQty = Math.max((product.stock_qty as number) + adj, 0)
        await db
          .from('products')
          .update({ stock_qty: newQty, updated_at: new Date().toISOString() })
          .eq('id', id)
      }
    }

    return NextResponse.json({ ok: true, updated: ids.length })
  } catch (err) {
    console.error('[admin/stock/bulk POST] error:', err)
    return NextResponse.json({ error: 'Failed to update stock' }, { status: 500 })
  }
}
