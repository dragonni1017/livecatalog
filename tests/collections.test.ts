import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { buildStripCards, isLive, notLiveReason, parseCollectionInput, slugify, todayPacific } from '../lib/collections'

describe('buildStripCards', () => {
  const cols = [
    { id: 'c1', slug: 'valentine', name: 'Valentine', cover_image_url: null },
    { id: 'c2', slug: 'graduation', name: 'Graduation', cover_image_url: 'https://img/cover.jpg' },
    { id: 'c3', slug: 'empty', name: 'All hidden', cover_image_url: null },
  ]
  const links = [
    { collection_id: 'c1', product_id: 'p3', position: 2 },
    { collection_id: 'c1', product_id: 'p1', position: 0 },
    { collection_id: 'c1', product_id: 'hidden', position: 1 },
    { collection_id: 'c1', product_id: 'p4', position: 3 },
    { collection_id: 'c1', product_id: 'p5', position: 4 },
    { collection_id: 'c1', product_id: 'p6', position: 5 },
    { collection_id: 'c2', product_id: 'p1', position: 0 },
    { collection_id: 'c3', product_id: 'hidden', position: 0 },
  ]
  const visible = [
    { id: 'p1', image_url: 'https://img/1.jpg' },
    { id: 'p3', image_url: 'https://img/3.jpg' },
    { id: 'p4', image_url: null },
    { id: 'p5', image_url: 'https://img/5.jpg' },
    { id: 'p6', image_url: 'https://img/6.jpg' },
  ]
  const cards = buildStripCards(cols, links, visible)

  it('keeps collection order and skips one with no visible products', () => {
    expect(cards.map((c) => c.slug)).toEqual(['valentine', 'graduation'])
  })
  it('counts only visible products', () => {
    expect(cards[0].productCount).toBe(5)
  })
  it('mosaic uses the first photos by position, skips missing images, max 4', () => {
    expect(cards[0].mosaic).toEqual(['https://img/1.jpg', 'https://img/3.jpg', 'https://img/5.jpg', 'https://img/6.jpg'])
  })
  it('passes the cover through when set', () => {
    expect(cards[1].cover).toBe('https://img/cover.jpg')
    expect(cards[0].cover).toBeNull()
  })
})

describe('todayPacific', () => {
  it('uses the Los Angeles date, not UTC', () => {
    // 2026-02-15 05:00 UTC is still Feb 14 in LA (UTC-8).
    expect(todayPacific(new Date('2026-02-15T05:00:00Z'))).toBe('2026-02-14')
    expect(todayPacific(new Date('2026-02-15T09:00:00Z'))).toBe('2026-02-15')
  })
})

describe('isLive / notLiveReason', () => {
  const c = (over: Partial<{ is_active: boolean; starts_on: string | null; ends_on: string | null }> = {}) => ({
    is_active: true, starts_on: null, ends_on: null, ...over,
  })
  it('active with no dates is live', () => {
    expect(isLive(c(), '2026-10-16')).toBe(true)
    expect(notLiveReason(c(), '2026-10-16')).toBeNull()
  })
  it('the window is inclusive on both ends', () => {
    const v = c({ starts_on: '2027-02-01', ends_on: '2027-02-14' })
    expect(isLive(v, '2027-01-31')).toBe(false)
    expect(isLive(v, '2027-02-01')).toBe(true)
    expect(isLive(v, '2027-02-14')).toBe(true)
    expect(isLive(v, '2027-02-15')).toBe(false)
    expect(notLiveReason(v, '2027-01-31')).toBe('Starts 2027-02-01')
    expect(notLiveReason(v, '2027-02-15')).toBe('Ended 2027-02-14')
  })
  it('switched off beats any dates', () => {
    expect(isLive(c({ is_active: false }), '2026-10-16')).toBe(false)
    expect(notLiveReason(c({ is_active: false }), '2026-10-16')).toBe('Off')
  })
})

describe('slugify', () => {
  it('makes a URL-safe name', () => {
    expect(slugify("Valentine's Day 2027")).toBe('valentine-s-day-2027')
    expect(slugify('  Mother & Father ')).toBe('mother-and-father')
    expect(slugify('Fête de Noël')).toBe('fete-de-noel')
    expect(slugify('---')).toBe('')
  })
})

describe('parseCollectionInput', () => {
  it('derives the slug from the name and defaults to active', () => {
    const r = parseCollectionInput({ name: 'Graduation' })
    expect(r).toEqual({
      value: { slug: 'graduation', name: 'Graduation', description: null, is_active: true, starts_on: null, ends_on: null, display_order: 0, cover_image_url: null },
    })
  })
  it('rejects bad input', () => {
    expect(parseCollectionInput({})).toHaveProperty('error')
    expect(parseCollectionInput({ name: 'x'.repeat(81) })).toHaveProperty('error')
    expect(parseCollectionInput({ name: 'A', slug: 'Has Spaces' })).toHaveProperty('error')
    expect(parseCollectionInput({ name: 'A', slug: '../admin' })).toHaveProperty('error')
    expect(parseCollectionInput({ name: 'A', starts_on: '2027-02-14', ends_on: '2027-02-01' })).toHaveProperty('error')
    expect(parseCollectionInput({ name: 'A', starts_on: 'Feb 1' })).toHaveProperty('error')
    expect(parseCollectionInput({ name: 'A', display_order: 1.5 })).toHaveProperty('error')
  })
  it('accepts only an https cover image link', () => {
    const ok = parseCollectionInput({ name: 'A', cover_image_url: ' https://x.supabase.co/storage/v1/object/public/product-images/a.jpg ' })
    expect('value' in ok && ok.value.cover_image_url).toBe('https://x.supabase.co/storage/v1/object/public/product-images/a.jpg')
    for (const bad of ['http://x/a.jpg', 'javascript:alert(1)', 'https://x/a.jpg" onerror="x', '//x/a.jpg', `https://x/${'a'.repeat(1000)}`]) {
      expect(parseCollectionInput({ name: 'A', cover_image_url: bad }), bad).toHaveProperty('error')
    }
    const none = parseCollectionInput({ name: 'A', cover_image_url: '' })
    expect('value' in none && none.value.cover_image_url).toBeNull()
  })
  it('treats empty dates as open-ended', () => {
    const r = parseCollectionInput({ name: 'A', starts_on: '', ends_on: '' })
    expect('value' in r && r.value.starts_on === null && r.value.ends_on === null).toBe(true)
  })
})

// ── PUT /admin/api/collections/[id]/products ────────────────────────────────
// Records every write so the test can check order of operations and filters.

const calls = vi.hoisted(() => ({ log: [] as { op: string; table: string; args: unknown[] }[] }))
const DB = vi.hoisted(() => ({
  collections: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Valentine' }],
  products: [
    { id: 'prod-1', sku: 'A1', is_active: true, manually_hidden: false },
    { id: 'prod-2', sku: 'B2', is_active: true, manually_hidden: true },
    { id: 'prod-3', sku: 'c3', is_active: true, manually_hidden: false },
  ] as Record<string, unknown>[],
}))
vi.mock('../lib/audit', () => ({ logAudit: async () => {} }))
vi.mock('../lib/auth-server', () => ({ getActorEmail: async () => 'admin@example.com' }))
vi.mock('../lib/supabase', () => ({
  getAdminClient: () => ({
    from: (table: string) => {
      let rows = [...((DB as Record<string, Record<string, unknown>[]>)[table] ?? [])]
      const b = {
        select: () => b,
        eq: (col: string, v: unknown) => {
          calls.log.push({ op: 'eq', table, args: [col, v] })
          rows = rows.filter((r) => r[col] === undefined || r[col] === v)
          return b
        },
        in: (col: string, vals: unknown[]) => {
          rows = rows.filter((r) => vals.includes(r[col]))
          return b
        },
        not: (...args: unknown[]) => {
          calls.log.push({ op: 'not', table, args })
          return b
        },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        upsert: async (data: unknown, opts: unknown) => {
          calls.log.push({ op: 'upsert', table, args: [data, opts] })
          return { error: null }
        },
        delete: () => {
          calls.log.push({ op: 'delete', table, args: [] })
          return b
        },
        then: (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: rows, error: null }),
      }
      return b
    },
  }),
}))

describe('PUT collection products', async () => {
  const { PUT } = await import('../app/admin/api/collections/[id]/products/route')
  const ID = '11111111-1111-4111-8111-111111111111'
  const put = (skus: string) =>
    PUT(new NextRequest(`http://x/admin/api/collections/${ID}/products`, { method: 'PUT', body: JSON.stringify({ skus }) }), {
      params: Promise.resolve({ id: ID }),
    })

  it('saves in pasted order, reports unknown and hidden, and writes before it prunes', async () => {
    calls.log = []
    const res = await put('c3\nA1, B2\nNOPE')
    const json = await res.json()
    expect(json).toEqual({ saved: ['c3', 'A1', 'B2'], notFound: ['NOPE'], hidden: ['B2'] })

    const upsert = calls.log.find((c) => c.op === 'upsert')!
    expect(upsert.args[0]).toEqual([
      { collection_id: ID, product_id: 'prod-3', position: 0 },
      { collection_id: ID, product_id: 'prod-1', position: 1 },
      { collection_id: ID, product_id: 'prod-2', position: 2 },
    ])
    const ops = calls.log.filter((c) => c.op === 'upsert' || c.op === 'delete').map((c) => c.op)
    expect(ops).toEqual(['upsert', 'delete']) // never delete first
    const keep = calls.log.find((c) => c.op === 'not')!
    expect(keep.args).toEqual(['product_id', 'in', '("prod-3","prod-1","prod-2")'])
  })

  it('SKU matching is exact (case matters)', async () => {
    calls.log = []
    const json = await (await put('a1')).json()
    expect(json.notFound).toEqual(['a1'])
  })

  it('an empty list clears the collection without a keep-filter', async () => {
    calls.log = []
    const json = await (await put('')).json()
    expect(json.saved).toEqual([])
    expect(calls.log.some((c) => c.op === 'upsert')).toBe(false)
    expect(calls.log.some((c) => c.op === 'not')).toBe(false)
    expect(calls.log.some((c) => c.op === 'delete')).toBe(true)
  })

  it('a non-uuid id is 404', async () => {
    const res = await PUT(new NextRequest('http://x', { method: 'PUT', body: '{}' }), { params: Promise.resolve({ id: 'x' }) })
    expect(res.status).toBe(404)
  })
})
