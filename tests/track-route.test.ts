import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// /api/track input handling. With NEXT_PUBLIC_SUPABASE_URL unset the route is in
// mock mode: it validates exactly as in production, then answers { mock: true }
// instead of inserting, so this never touches the database.

const { POST } = await import('../app/api/track/route')

let ipCounter = 0
// A fresh IP per request keeps the module-level 60/min limiter out of the way.
const send = async (body: unknown) => {
  ipCounter++
  const res = await POST(
    new NextRequest('http://x/api/track', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'x-forwarded-for': `10.0.${ipCounter >> 8}.${ipCounter & 255}` },
    }),
  )
  return { status: res.status, json: await res.json() }
}

const VID = '0b7c6f5e-1d2a-4c3b-9e8f-7a6b5c4d3e2f'

beforeEach(() => vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', ''))
afterEach(() => vi.unstubAllEnvs())

describe('/api/track', () => {
  it('rejects unknown or missing types', async () => {
    expect((await send({ type: 'purchase' })).status).toBe(400)
    expect((await send({})).status).toBe(400)
    expect((await send({ type: ['view'] })).status).toBe(400)
    expect((await send('not json')).status).toBe(400)
  })

  it('accepts each funnel step with a visitor id', async () => {
    for (const type of ['add_to_cart', 'cart_view', 'quote_submitted']) {
      const r = await send({ type, visitorId: VID })
      expect(r.status, type).toBe(200)
      expect(r.json.mock, type).toBe(true)
    }
  })

  it('skips funnel steps without a usable visitor id (never stores an orphan step)', async () => {
    for (const visitorId of [undefined, '', 'short', '<script>alert(1)</script>', 'x'.repeat(65), 42]) {
      const r = await send({ type: 'cart_view', visitorId })
      expect(r.json.skipped, String(visitorId)).toBe(true)
      expect(r.json.mock).toBeUndefined()
    }
  })

  it('still records views and searches without a visitor id (older browsers)', async () => {
    expect((await send({ type: 'view', productId: 'prod-00001' })).json.mock).toBe(true)
    expect((await send({ type: 'search', term: 'bows' })).json.mock).toBe(true)
  })

  it('validates view product ids and search terms', async () => {
    expect((await send({ type: 'view' })).status).toBe(400)
    expect((await send({ type: 'view', productId: 'p'.repeat(65) })).status).toBe(400)
    expect((await send({ type: 'search', term: 'a' })).json.skipped).toBe(true)
    expect((await send({ type: 'search_no_results', query: 'zz top' })).json.mock).toBe(true)
  })

  it('rate-limits one IP to 60 events a minute, silently', async () => {
    const req = () =>
      POST(new NextRequest('http://x/api/track', {
        method: 'POST',
        body: JSON.stringify({ type: 'cart_view', visitorId: VID }),
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9' },
      }))
    const results = []
    for (let i = 0; i < 61; i++) results.push(await (await req()).json())
    expect(results.slice(0, 60).every((r) => r.mock === true)).toBe(true)
    expect(results[60]).toEqual({ ok: true, skipped: true })
  })
})

// ── What actually gets inserted (non-mock mode, DB stubbed) ──────────────────
describe('/api/track insert payload', () => {
  it('stores a known source and drops anything else', async () => {
    const inserted: Record<string, unknown>[] = []
    vi.resetModules()
    vi.doMock('../lib/supabase', () => ({
      getAdminClient: () => ({
        from: () => ({
          insert: async (row: Record<string, unknown>) => {
            inserted.push(row)
            return { error: null }
          },
        }),
      }),
    }))
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co')
    const { POST: livePost } = await import('../app/api/track/route')
    const post = (body: unknown, ip: string) =>
      livePost(new NextRequest('http://x/api/track', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-forwarded-for': ip } }))

    await post({ type: 'view', productId: 'prod-00001', visitorId: VID, source: 'qr' }, '198.51.100.1')
    await post({ type: 'view', productId: 'prod-00001', visitorId: VID, source: 'email' }, '198.51.100.2')
    await post({ type: 'view', productId: 'prod-00001', visitorId: VID, source: "qr'; drop table x" }, '198.51.100.3')
    await post({ type: 'view', productId: 'prod-00001', visitorId: VID }, '198.51.100.4')

    expect(inserted.map((r) => r.source)).toEqual(['qr', null, null, null])
    expect(inserted[0]).toMatchObject({ type: 'view', product_id: 'prod-00001', visitor_id: VID, source: 'qr' })
    vi.doUnmock('../lib/supabase')
  })
})
