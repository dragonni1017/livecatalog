/**
 * POST /api/webhooks/woo
 *
 * Receives order webhooks from WooCommerce and immediately decrements
 * stock_qty in Supabase — faster than waiting for the next cron run.
 *
 * Setup in WooCommerce:
 *   WooCommerce → Settings → Advanced → Webhooks → Add webhook
 *   Topic: Order updated
 *   Delivery URL: https://your-site.com/api/webhooks/woo
 *   Secret: value of WOO_WEBHOOK_SECRET env var
 *
 * WooCommerce signs each request with HMAC-SHA256.  We verify the signature
 * before touching the database.
 *
 * Idempotency note: WooCommerce may deliver the same event more than once.
 * A production system should record processed order IDs to avoid double
 * decrementing.  For now, treat stock as "eventually correct" — the cron
 * sync corrects any drift within 30 minutes.
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

// ── WooCommerce payload shape (partial) ──────────────────────────────────────

interface WooLineItem {
  product_id: number
  variation_id: number
  quantity: number
  sku: string
  name: string
}

interface WooOrder {
  id: number
  status: 'pending' | 'processing' | 'on-hold' | 'completed' | 'cancelled' | 'refunded' | 'failed'
  line_items: WooLineItem[]
}

// ── Signature verification ────────────────────────────────────────────────────

function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.WOO_WEBHOOK_SECRET
  if (!secret) {
    console.warn('[woo-webhook] WOO_WEBHOOK_SECRET not set — skipping signature check')
    return true  // allow through in dev; always set this in production
  }
  if (!signatureHeader) return false

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('base64')

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader))
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const rawBody = await request.text()

  // Verify HMAC signature
  if (!verifySignature(rawBody, request.headers.get('x-wc-webhook-signature'))) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // Only process order events
  const topic = request.headers.get('x-wc-webhook-topic') ?? ''
  if (!topic.startsWith('order.')) {
    return NextResponse.json({ ok: true, skipped: true })
  }

  let order: WooOrder
  try {
    order = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Only decrement stock when payment is confirmed
  const shouldDecrement = order.status === 'processing' || order.status === 'completed'
  // TODO: increment back on cancellation / refund
  // const shouldIncrement = order.status === 'cancelled' || order.status === 'refunded'

  if (!shouldDecrement) {
    return NextResponse.json({ ok: true, skipped: true, reason: `status is ${order.status}` })
  }

  const lineItems = order.line_items?.filter((item) => item.sku && item.quantity > 0) ?? []
  if (lineItems.length === 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'no line items with SKU' })
  }

  try {
    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()

    const results = await Promise.allSettled(
      // adjust_stock() (migration 0018) takes a signed delta and does the
      // clamp-at-0 + audit row atomically. NOTE: not live today (see
      // docs/LIVE-INVENTORY-COUNT-HANDOFF.md); this just repoints a call that
      // referenced a function that never existed (decrement_stock) so it
      // stops failing silently if this webhook is enabled later.
      lineItems.map((item) =>
        db.rpc('adjust_stock', {
          p_sku: item.sku,
          p_delta: -item.quantity,
          p_reason: `woo order ${order.id}`,
          p_changed_by_email: 'woo-webhook',
        })
      ),
    )

    const failed = results.filter((r) => r.status === 'rejected')
    if (failed.length > 0) {
      console.error('[woo-webhook] Some stock decrements failed:', failed)
    }

    console.log(`[woo-webhook] Order ${order.id} — decremented ${lineItems.length} SKUs`)
    return NextResponse.json({ ok: true, orderId: order.id, itemsProcessed: lineItems.length })
  } catch (err) {
    console.error('[woo-webhook] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
