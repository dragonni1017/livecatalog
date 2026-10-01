import crypto from 'crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'
import { hasBearerOrQueryToken, hasBearerSecret, hasWooSignature, safeEqual } from '../lib/request-auth'

const req = (url: string, auth?: string) =>
  new Request(url, { headers: auth ? { authorization: auth } : {} }) as unknown as NextRequest

afterEach(() => vi.unstubAllEnvs())
vi.spyOn(console, 'error').mockImplementation(() => {})

describe('safeEqual', () => {
  it('compares without throwing on a length mismatch', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
    expect(safeEqual('', 'x')).toBe(false)
  })
})

describe('hasBearerSecret (CRON_SECRET)', () => {
  it('fails closed when the secret is unset', () => {
    vi.stubEnv('CRON_SECRET', '')
    expect(hasBearerSecret(req('https://x/api/sync'), 'CRON_SECRET')).toBe(false)
    expect(hasBearerSecret(req('https://x/api/sync', 'Bearer '), 'CRON_SECRET')).toBe(false)
  })
  it('accepts only the exact bearer value', () => {
    vi.stubEnv('CRON_SECRET', 's3cret')
    expect(hasBearerSecret(req('https://x/api/sync', 'Bearer s3cret'), 'CRON_SECRET')).toBe(true)
    expect(hasBearerSecret(req('https://x/api/sync', 'Bearer wrong'), 'CRON_SECRET')).toBe(false)
    expect(hasBearerSecret(req('https://x/api/sync'), 'CRON_SECRET')).toBe(false)
  })
})

describe('hasBearerOrQueryToken (ERPLY_WEBHOOK_TOKEN)', () => {
  it('fails closed when the token is unset, even with an empty token param', () => {
    vi.stubEnv('ERPLY_WEBHOOK_TOKEN', '')
    expect(hasBearerOrQueryToken(req('https://x/api/webhooks/erply'), 'ERPLY_WEBHOOK_TOKEN')).toBe(false)
    expect(hasBearerOrQueryToken(req('https://x/api/webhooks/erply?token='), 'ERPLY_WEBHOOK_TOKEN')).toBe(false)
  })
  it('accepts the token as a header or a query param', () => {
    vi.stubEnv('ERPLY_WEBHOOK_TOKEN', 'tok')
    expect(hasBearerOrQueryToken(req('https://x/api/webhooks/erply', 'Bearer tok'), 'ERPLY_WEBHOOK_TOKEN')).toBe(true)
    expect(hasBearerOrQueryToken(req('https://x/api/webhooks/erply?token=tok'), 'ERPLY_WEBHOOK_TOKEN')).toBe(true)
    expect(hasBearerOrQueryToken(req('https://x/api/webhooks/erply?token=nope'), 'ERPLY_WEBHOOK_TOKEN')).toBe(false)
  })
})

describe('hasWooSignature', () => {
  const body = '{"id":1}'
  const sign = (secret: string) => crypto.createHmac('sha256', secret).update(body, 'utf8').digest('base64')

  it('fails closed when the secret is unset', () => {
    vi.stubEnv('WOO_WEBHOOK_SECRET', '')
    expect(hasWooSignature(body, sign('anything'))).toBe(false)
  })
  it('accepts a valid signature and rejects a wrong or wrong-length one', () => {
    vi.stubEnv('WOO_WEBHOOK_SECRET', 'woo')
    expect(hasWooSignature(body, sign('woo'))).toBe(true)
    expect(hasWooSignature(body, sign('other'))).toBe(false)
    expect(hasWooSignature(body, 'short')).toBe(false)
    expect(hasWooSignature(body, null)).toBe(false)
  })
})
