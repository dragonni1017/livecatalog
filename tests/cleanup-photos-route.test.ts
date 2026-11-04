import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// POST /admin/api/cleanup/photos against an in-memory products table.
// Proves: photos are recorded; products still hidden come back in hiddenNow
// (with whether they're priced) and are NOT unhidden; a product that already
// has a photo is skipped unless replace is set.

const db = vi.hoisted(() => ({
  products: [] as Record<string, unknown>[],
  audit: [] as Record<string, unknown>[],
}))

vi.mock('../lib/audit', () => ({ logAudit: async (e: Record<string, unknown>) => { db.audit.push(e) } }))
vi.mock('../lib/auth-server', () => ({ getActorEmail: async () => 'admin' }))

vi.mock('../lib/supabase', () => {
  const from = () => {
    const filters: ((r: Record<string, unknown>) => boolean)[] = []
    let patch: Record<string, unknown> | null = null
    const run = () => {
      const rows = db.products.filter((r) => filters.every((f) => f(r)))
      if (patch) rows.forEach((r) => Object.assign(r, patch))
      return { data: rows.map((r) => ({ ...r })), error: null }
    }
    const b: Record<string, unknown> = {
      select: () => b,
      in: (c: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[c])); return b },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b },
      // Only the route's "no image yet" guard.
      or: () => { filters.push((r) => !r.image_url); return b },
      update: (p: Record<string, unknown>) => { patch = p; return b },
      then: (resolve: (v: unknown) => void) => resolve(run()),
    }
    return b
  }
  return { getAdminClient: () => ({ from }) }
})

const { POST } = await import('../app/admin/api/cleanup/photos/route')
const url = (id: string) => `https://res.cloudinary.com/demo/image/upload/v1/${id}.jpg`
const call = (body: unknown) =>
  POST(new NextRequest('http://x/admin/api/cleanup/photos', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  process.env.CLOUDINARY_CLOUD_NAME = 'demo'
  db.audit = []
  db.products = [
    { id: 'p1', sku: 'A1', name: 'Hidden priced', image_url: null, manually_hidden: true, price_cents: 500 },
    { id: 'p2', sku: 'B2', name: 'Hidden at zero', image_url: null, manually_hidden: true, price_cents: 0 },
    { id: 'p3', sku: 'C3', name: 'Visible', image_url: null, manually_hidden: false, price_cents: 300 },
    { id: 'p4', sku: 'D4', name: 'Has photo', image_url: url('D4'), manually_hidden: true, price_cents: 300 },
  ]
})

describe('POST /admin/api/cleanup/photos', () => {
  it('records photos and lists the still-hidden ones without unhiding them', async () => {
    const res = await call({
      items: [
        { sku: 'A1', urls: [url('A1'), url('A1-2')] },
        { sku: 'B2', urls: [url('B2')] },
        { sku: 'C3', urls: [url('C3')] },
        { sku: 'D4', urls: [url('D4')] },
      ],
    })
    const json = await res.json()
    expect(json.updated).toBe(3)
    expect(json.skipped).toEqual(['D4'])
    expect(json.hiddenNow).toEqual([
      { id: 'p1', sku: 'A1', name: 'Hidden priced', priced: true },
      { id: 'p2', sku: 'B2', name: 'Hidden at zero', priced: false },
    ])
    expect(db.products.find((p) => p.id === 'p1')).toMatchObject({
      image_url: url('A1'),
      image_urls: [url('A1'), url('A1-2')],
      needs_photo: false,
      manually_hidden: true,
    })
    expect(db.audit.map((a) => a.entity_label)).toEqual(['A1', 'B2', 'C3'])
  })

  it('replacing a hidden product photo also lists it', async () => {
    const json = await (await call({ items: [{ sku: 'D4', urls: [url('D4-2')] }], replace: true })).json()
    expect(json.updated).toBe(1)
    expect(json.hiddenNow.map((h: { sku: string }) => h.sku)).toEqual(['D4'])
  })

  it('refuses a URL named for another SKU and lists nothing', async () => {
    const json = await (await call({ items: [{ sku: 'A1', urls: [url('B2')] }] })).json()
    expect(json.updated).toBe(0)
    expect(json.failures[0]).toMatch(/^A1: refused/)
    expect(json.hiddenNow).toEqual([])
  })
})
