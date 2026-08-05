/**
 * POST /api/webhooks/erply/customers
 *
 * SCAFFOLDING ONLY — see docs/memory/project-woocommerce-tier-mapping.md.
 * Not registered as a live Erply webhook yet. This route parses the
 * request and records what it *would* do, but makes no write to
 * WooCommerce or Supabase until the three blockers below clear:
 *
 *   1. Retail and Exclusive Wholesale Suite roles don't exist in
 *      WooCommerce yet (only Wholesale/`default_wholesaler` and
 *      Distribution-Chain/`chain` do) — see lib/tier-mapping.ts.
 *   2. The third-party Erply->Woo customer import (running as of
 *      2026-08-04) needs to finish so this doesn't race it.
 *   3. The actual Erply "Customer saved" webhook payload shape is
 *      unconfirmed — the interface below is a best guess, adjust once a
 *      real payload has been inspected (same caveat as the sibling stock
 *      webhook route.ts).
 *
 * Intended flow once live:
 *   Erply back office -> Settings -> Webhooks -> Add new webhook
 *   Event: Customer saved (or equivalent "customer changed" event)
 *   URL: https://your-site.com/api/webhooks/erply/customers
 *   Token: same ERPLY_WEBHOOK_TOKEN env var as the stock webhook
 *
 *   1. Match by email against erply_woo_customer_links, or against
 *      wc/v3/customers?email= if no link row exists yet.
 *   2. New customer, no tier on the payload -> default to Wholesale
 *      (fixed policy, see lib/tier-mapping.ts DEFAULT_TIER).
 *   3. Look up the Woo role via wooRoleForTier() — if null (Retail/
 *      Exclusive/Base), log and skip; never fall back to another role.
 *   4. PUT wc/v3/customers/{id} with the resolved role slug.
 *   5. Upsert erply_woo_customer_links (email, erply_customer_id,
 *      erply_tier, woo_customer_id, woo_role_slug, last_synced_at,
 *      last_sync_source='erply').
 */

import { NextRequest, NextResponse } from 'next/server'
import { DEFAULT_TIER, wooRoleForTier } from '@/lib/tier-mapping'

interface ErplyCustomerEvent {
  event: string // e.g. "customerSaved" — unconfirmed, adjust once seen live
  customerID: number
  email?: string
  groupName?: string // unconfirmed field name for the customer's tier/group
}

function isAuthorized(request: NextRequest): boolean {
  const token = process.env.ERPLY_WEBHOOK_TOKEN
  if (!token) {
    console.warn('[erply-webhook:customers] ERPLY_WEBHOOK_TOKEN not set — endpoint is unprotected')
    return true
  }
  const headerToken = request.headers.get('authorization')?.replace('Bearer ', '')
  const queryToken = new URL(request.url).searchParams.get('token')
  return headerToken === token || queryToken === token
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: ErplyCustomerEvent
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!payload.email) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'no email on payload' })
  }

  const tier = payload.groupName || DEFAULT_TIER
  const targetRole = wooRoleForTier(tier)

  console.log(
    `[erply-webhook:customers] SCAFFOLDING — would sync ${payload.email} ` +
      `(erply customer ${payload.customerID}, tier "${tier}") ` +
      `-> Woo role ${targetRole ? targetRole.slug : '(none — tier has no role yet, would skip)'}`,
  )

  // Deliberately no Woo write, no Supabase upsert — see file header.
  return NextResponse.json({
    ok: true,
    scaffolding: true,
    email: payload.email,
    tier,
    resolvedWooRole: targetRole?.slug ?? null,
  })
}
