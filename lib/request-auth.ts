import crypto from 'crypto'
import type { NextRequest } from 'next/server'

// Shared checks for the machine-called routes under /api/* (cron, webhooks).
// middleware.ts lets every /api/* path through, so these checks are the only
// thing guarding those routes.
//
// All of them FAIL CLOSED: an unset secret rejects every request. Each route
// used to `return true` when its env var was missing ("allow through in
// dev"). In production that left /api/webhooks/erply writable by anyone,
// since ERPLY_WEBHOOK_TOKEN has never been set in Vercel (found 2026-10-01).
// To call one of these locally, set the secret in .env.local.

/** Constant-time string compare that's safe on a length mismatch. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  // timingSafeEqual throws on unequal lengths, which used to surface as an
  // unhandled 500 from the Woo webhook. Compare against self to keep the
  // timing flat, then report false.
  if (ab.length !== bb.length) {
    crypto.timingSafeEqual(ab, ab)
    return false
  }
  return crypto.timingSafeEqual(ab, bb)
}

/** `Authorization: Bearer <secret>`. This is how Vercel Cron sends CRON_SECRET. */
export function hasBearerSecret(request: NextRequest, envName: string): boolean {
  const secret = process.env[envName]
  if (!secret) {
    console.error(`[auth] ${envName} not set; rejecting ${new URL(request.url).pathname}`)
    return false
  }
  const header = request.headers.get('authorization') ?? ''
  return safeEqual(header, `Bearer ${secret}`)
}

/**
 * Bearer header OR `?token=` query param. Erply's webhook settings may only
 * allow a URL, so the query form is kept, even though it leaks into access
 * logs. Prefer the header wherever the sender supports it.
 */
export function hasBearerOrQueryToken(request: NextRequest, envName: string): boolean {
  const token = process.env[envName]
  if (!token) {
    console.error(`[auth] ${envName} not set; rejecting ${new URL(request.url).pathname}`)
    return false
  }
  const header = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
  const query = new URL(request.url).searchParams.get('token') ?? ''
  return safeEqual(header, token) || safeEqual(query, token)
}

/** WooCommerce `X-WC-Webhook-Signature`: base64 HMAC-SHA256 of the raw body. */
export function hasWooSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = process.env.WOO_WEBHOOK_SECRET
  if (!secret) {
    console.error('[auth] WOO_WEBHOOK_SECRET not set; rejecting Woo webhook')
    return false
  }
  if (!signatureHeader) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')
  return safeEqual(expected, signatureHeader)
}
