/**
 * POST /api/webhooks/erply
 *
 * Receives stock-change events from Erply and immediately updates
 * stock_qty in Supabase.  Covers in-store POS sales and manual
 * stock adjustments that WooCommerce won't know about.
 *
 * Setup in Erply:
 *   Erply back office → Settings → Webhooks → Add new webhook
 *   Events: Sale saved, Inventory registration confirmed
 *   URL: https://your-site.com/api/webhooks/erply
 *   Set a secret token → use as ERPLY_WEBHOOK_TOKEN env var
 *
 * The cron sync (/api/sync) already catches everything — this webhook
 * is optional, for cases where 30-minute lag on in-store stock is
 * not acceptable.
 */

import { NextRequest, NextResponse } from 'next/server'

// ── Erply webhook payload shape (partial) ─────────────────────────────────────
// Erply webhook payloads vary by event type.  The fields below cover the most
// common inventory events.  Adjust as needed once you have live payloads to inspect.

interface ErplyStockChange {
  event: string           // e.g. "sale", "inventoryRegistration", "stockAdjustment"
  warehouseID: number
  rows: Array<{
    productID: number
    code: string          // SKU
    name: string
    amount: number        // units sold / adjusted (positive = added, negative = removed)
    amountInStock: number // absolute stock level after the change (use this when available)
  }>
}

// ── Auth ──────────────────────────────────────────────────────────────────────

function isAuthorized(request: NextRequest): boolean {
  const token = process.env.ERPLY_WEBHOOK_TOKEN
  if (!token) {
    console.warn('[erply-webhook] ERPLY_WEBHOOK_TOKEN not set — endpoint is unprotected')
    return true
  }
  // Erply can send the token as a query param or Authorization header —
  // configure whichever you choose in the Erply webhook settings.
  const headerToken = request.headers.get('authorization')?.replace('Bearer ', '')
  const queryToken  = new URL(request.url).searchParams.get('token')
  return headerToken === token || queryToken === token
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: ErplyStockChange
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { rows = [] } = payload
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'no rows in payload' })
  }

  try {
    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()

    const results = await Promise.allSettled(
      rows.map((row) => {
        if (typeof row.amountInStock === 'number') {
          // Prefer absolute stock value when Erply provides it
          return db
            .from('products')
            .update({ stock_qty: row.amountInStock, updated_at: new Date().toISOString() })
            .eq('sku', row.code)
        }
        // Fall back to relative adjustment
        return db.rpc('decrement_stock', { p_sku: row.code, p_qty: -row.amount })
        // (negative amount = sold/removed, positive = restocked)
      }),
    )

    const failed = results.filter((r) => r.status === 'rejected')
    if (failed.length > 0) {
      console.error('[erply-webhook] Some stock updates failed:', failed)
    }

    console.log(`[erply-webhook] ${payload.event} — updated ${rows.length} SKUs`)
    return NextResponse.json({ ok: true, event: payload.event, rowsProcessed: rows.length })
  } catch (err) {
    console.error('[erply-webhook] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
