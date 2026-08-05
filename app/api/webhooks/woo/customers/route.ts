/**
 * POST /api/webhooks/woo/customers
 *
 * SCAFFOLDING ONLY — see docs/memory/project-woocommerce-tier-mapping.md.
 * Not registered as a live WooCommerce webhook yet. Parses and logs the
 * intended action but makes no write to Erply or Supabase — creating a
 * customer via Erply's API has never been tested in this project (only
 * product/session calls exist so far, see lib/erply.ts), and the
 * third-party Erply->Woo import running as of 2026-08-04 should finish
 * before this races it.
 *
 * Intended flow once live:
 *   WooCommerce -> Settings -> Advanced -> Webhooks -> Add webhook
 *   Topic: Customer created
 *   Delivery URL: https://your-site.com/api/webhooks/woo/customers
 *   Secret: same WOO_WEBHOOK_SECRET env var as the order/stock webhook
 *
 *   1. Verify HMAC signature (same pattern as sibling webhooks/woo/route.ts).
 *   2. Match by email against erply_woo_customer_links; if a link already
 *      exists (e.g. this customer came from the third-party import), skip —
 *      that import already set both sides.
 *   3. No existing link -> this is a brand-new online signup with no Erply
 *      record. Create the Erply customer (classic API `saveCustomer`,
 *      unverified — confirm request/response shape live before wiring this
 *      up for real) defaulted to Wholesale (DEFAULT_TIER, fixed policy).
 *   4. Upsert erply_woo_customer_links (email, erply_customer_id,
 *      erply_tier='Wholesale', woo_customer_id, woo_role_slug,
 *      last_synced_at, last_sync_source='woo').
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { DEFAULT_TIER, wooRoleForTier } from '@/lib/tier-mapping'

interface WooCustomer {
  id: number
  email: string
  role?: string
}

function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.WOO_WEBHOOK_SECRET
  if (!secret) {
    console.warn('[woo-webhook:customers] WOO_WEBHOOK_SECRET not set — skipping signature check')
    return true
  }
  if (!signatureHeader) return false

  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader))
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()

  if (!verifySignature(rawBody, request.headers.get('x-wc-webhook-signature'))) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const topic = request.headers.get('x-wc-webhook-topic') ?? ''
  if (!topic.startsWith('customer.')) {
    return NextResponse.json({ ok: true, skipped: true })
  }

  let customer: WooCustomer
  try {
    customer = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!customer.email) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'no email on payload' })
  }

  const targetRole = wooRoleForTier(DEFAULT_TIER)

  console.log(
    `[woo-webhook:customers] SCAFFOLDING — would check erply_woo_customer_links for ` +
      `${customer.email}; if no link exists, would create in Erply as tier "${DEFAULT_TIER}" ` +
      `(Woo role ${targetRole ? targetRole.slug : '(none)'})`,
  )

  // Deliberately no Erply write, no Supabase upsert — see file header.
  return NextResponse.json({
    ok: true,
    scaffolding: true,
    wooCustomerId: customer.id,
    email: customer.email,
    defaultTier: DEFAULT_TIER,
  })
}
