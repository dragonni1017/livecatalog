import { describe, expect, it } from 'vitest'
import { catalogAccessToken, hasCatalogAccess, isUngatedApi } from '@/lib/catalog-gate'

describe('catalog access cookie', () => {
  it('is an HMAC of the code: stable, opaque, and code-specific', async () => {
    const a = await catalogAccessToken('open-sesame')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(await catalogAccessToken('open-sesame')).toBe(a)
    expect(await catalogAccessToken('different')).not.toBe(a)
    expect(a).not.toContain('open-sesame')
  })

  it('accepts only the token for the current code', async () => {
    const t = await catalogAccessToken('open-sesame')
    expect(await hasCatalogAccess(t, 'open-sesame')).toBe(true)
    expect(await hasCatalogAccess(t, 'rotated-code')).toBe(false)
  })

  it("rejects the old hand-settable 'granted' value and anything empty", async () => {
    expect(await hasCatalogAccess('granted', 'open-sesame')).toBe(false)
    expect(await hasCatalogAccess('', 'open-sesame')).toBe(false)
    expect(await hasCatalogAccess(undefined, 'open-sesame')).toBe(false)
  })
})

describe('isUngatedApi', () => {
  it.each([
    '/api/catalog-access',
    '/api/auth/callback',
    '/api/admin/auth',
    '/api/rep/auth',
    '/api/qbwc',
    '/api/sync',
    '/api/sync/customers',
    '/api/webhooks/erply',
    '/api/webhooks/woo/customers',
  ])('leaves %s open (sign-in, the code check, machines)', (p) => {
    expect(isUngatedApi(p)).toBe(true)
  })

  it.each([
    '/api/products/suggest',
    '/api/products/lookup',
    '/api/cart/reprice',
    '/api/cart-session',
    '/api/orders',
    '/api/order-reply',
    '/api/customer/tier',
    '/api/reps',
    '/api/track',
    '/api/back-in-stock',
    '/api/credit-application',
    '/api/syncx',
    '/api/authx',
  ])('gates %s', (p) => {
    expect(isUngatedApi(p)).toBe(false)
  })
})
