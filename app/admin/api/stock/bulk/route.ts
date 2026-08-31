import { NextRequest, NextResponse } from 'next/server'
import { applyAdminProductFilters, fetchAllRows, resolveCategoryMemberIds, type AdminProductFilterParams } from '@/lib/admin-products'

function isMockMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return !url || url === 'your-supabase-url' || url.includes('placeholder')
}

// "Select all matching filter" can trivially target thousands of products in
// one click (unlike the old page-everything-at-once table, where an explicit
// selection was naturally capped at whatever fit on screen) -- give this
// route the most headroom Vercel allows so a large filtered adjustment has a
// real chance to finish instead of always timing out.
export const maxDuration = 60

// Applies adjust_stock() to a batch of products concurrently (small chunks,
// not all at once) rather than one at a time -- sequential RPC calls for a
// "select all matching" run of a few thousand products would blow well past
// any serverless timeout; concurrent batches keep wall-clock time bounded.
const CONCURRENCY = 25

interface StockProduct { id: string; sku: string; stock_qty: number }

async function applyAdjustments(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  products: StockProduct[],
  mode: 'set' | 'adjust',
  adj: number,
): Promise<{ updated: number; failedSkus: string[] }> {
  const reason = mode === 'set' ? 'bulk set' : 'bulk adjust'
  let updated = 0
  const failedSkus: string[] = []

  for (let i = 0; i < products.length; i += CONCURRENCY) {
    const batch = products.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map((p) => {
        // 'set' mode: turn the target absolute qty into a delta against
        // current stock so it still goes through adjust_stock() as a delta +
        // audit row instead of a silent overwrite. 'adjust' mode: delta is
        // the adjustment itself. Either way, adjust_stock() clamps at 0 and
        // skips logging a zero-delta row.
        const delta = mode === 'set' ? adj - p.stock_qty : adj
        if (delta === 0) return Promise.resolve({ skipped: true as const })
        return db
          .rpc('adjust_stock', { p_sku: p.sku, p_delta: delta, p_reason: reason, p_changed_by_email: 'admin' })
          .then(({ error }: { error: unknown }) => ({ sku: p.sku, error }))
      }),
    )
    for (const r of results) {
      if (r.status === 'rejected') continue
      const v = r.value as { skipped?: true; sku?: string; error?: unknown }
      if (v.skipped) continue
      if (v.error) {
        console.error('[admin/stock/bulk POST] adjust_stock failed for', v.sku, v.error)
        failedSkus.push(v.sku as string)
      } else {
        updated++
      }
    }
  }

  return { updated, failedSkus }
}

// POST /admin/api/stock/bulk — apply a stock adjustment to multiple products
// at once. Body is either:
//   { ids: string[], adjustment: number, mode: 'set' | 'adjust' }
//   { filter: {q?, category?, visibility?, active?}, adjustment, mode }
// mode 'set'    -> stock_qty = adjustment for all matched products
// mode 'adjust' -> stock_qty = max(stock_qty + adjustment, 0)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { ids, filter, adjustment, mode } = body as {
      ids?: unknown
      filter?: AdminProductFilterParams
      adjustment?: unknown
      mode?: unknown
    }

    const hasIds = Array.isArray(ids) && ids.length > 0
    const hasFilter = filter !== undefined && filter !== null
    if (!hasIds && !hasFilter) {
      return NextResponse.json({ error: 'Provide either ids or filter' }, { status: 400 })
    }
    if (hasIds && !(ids as unknown[]).every((id) => typeof id === 'string' && id.length > 0)) {
      return NextResponse.json({ error: 'ids must be an array of strings' }, { status: 400 })
    }

    const adj = Number(adjustment)
    if (!Number.isInteger(adj)) {
      return NextResponse.json({ error: 'adjustment must be an integer' }, { status: 400 })
    }
    if (mode !== 'set' && mode !== 'adjust') {
      return NextResponse.json({ error: 'mode must be "set" or "adjust"' }, { status: 400 })
    }

    if (isMockMode()) {
      return NextResponse.json({ ok: true, mock: true, updated: hasIds ? (ids as unknown[]).length : 0 })
    }

    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()

    let products: StockProduct[]
    if (hasIds) {
      const { data, error: fetchError } = await db.from('products').select('id, sku, stock_qty').in('id', ids)
      if (fetchError) throw fetchError
      products = (data ?? []) as StockProduct[]
    } else {
      const { data: categories } = await db.from('categories').select('id, name, slug')
      const memberIds = await resolveCategoryMemberIds(db, categories ?? [], filter!.category)
      products = await fetchAllRows<StockProduct>(
        (from, to) =>
          applyAdminProductFilters(db.from('products').select('id, sku, stock_qty'), filter!, memberIds).range(
            from,
            to,
          ) as unknown as Promise<{ data: StockProduct[] | null; error: { message: string } | null }>,
      )
    }

    const { updated, failedSkus } = await applyAdjustments(db, products, mode, adj)

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
