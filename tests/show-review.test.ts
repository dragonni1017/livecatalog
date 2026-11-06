import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { auditJson, productChange } from '@/lib/product-audit'
import { keptHidden, orderCandidates, SHOW_REVIEW_KEEP, SHOW_REVIEW_REOPEN } from '@/lib/show-review'

describe('productChange', () => {
  it('separates visibility from other changed fields and skips bookkeeping', () => {
    const c = productChange(
      { manually_hidden: true, name: 'Bear', price_cents: 500, description: null },
      { manually_hidden: false, awaiting_price: false, updated_at: 'x', name: 'Bear', price_cents: 650, description: 'Soft bear.' },
    )
    expect(c.visibility).toEqual({ old: 'hidden', new: 'shown' })
    expect(c.fields).toEqual({ price_cents: { old: 500, new: 650 }, description: { old: null, new: 'Soft bear.' } })
  })
  it('reports nothing when nothing changed', () => {
    expect(productChange({ manually_hidden: false, name: 'A' }, { manually_hidden: false, name: 'A' })).toEqual({ visibility: null, fields: {} })
  })
  it('caps long audit values', () => {
    expect(auditJson({ d: 'x'.repeat(5000) }, 100)).toHaveLength(100)
  })
})

describe('keptHidden / orderCandidates', () => {
  it('uses the latest keep/reopen per product', () => {
    const kept = keptHidden([
      { entity_id: 'a', action: SHOW_REVIEW_KEEP, created_at: '2026-11-01' },
      { entity_id: 'a', action: SHOW_REVIEW_REOPEN, created_at: '2026-11-02' },
      { entity_id: 'b', action: SHOW_REVIEW_REOPEN, created_at: '2026-11-01' },
      { entity_id: 'b', action: SHOW_REVIEW_KEEP, created_at: '2026-11-03' },
      { entity_id: 'c', action: 'something_else', created_at: '2026-11-03' },
    ])
    expect([...kept]).toEqual(['b'])
  })
  it('orders most searched, then most stock, then SKU', () => {
    const rows = orderCandidates([
      { id: '1', sku: 'B', searches: 1, stock: 5 },
      { id: '2', sku: 'A', searches: 1, stock: 5 },
      { id: '3', sku: 'C', searches: 3, stock: 0 },
      { id: '4', sku: 'D', searches: 1, stock: 99 },
    ])
    expect(rows.map((r) => r.sku)).toEqual(['C', 'D', 'A', 'B'])
  })
})

// The products PATCH now logs a visibility change; the show-review route
// records Keep hidden as an audit row.
const db = vi.hoisted(() => ({ product: {} as Record<string, unknown>, audits: [] as Record<string, unknown>[], inserts: [] as Record<string, unknown>[] }))
vi.mock('../lib/auth-server', () => ({ getSessionUser: async () => ({ email: 'owner@example.com' }) }))
vi.mock('../lib/audit', () => ({ logAudit: async (e: Record<string, unknown>) => { db.audits.push(e) } }))
vi.mock('../lib/supabase', () => {
  const from = (table: string) => {
    let patch: Record<string, unknown> | null = null
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      gt: () => b,
      update: (p: Record<string, unknown>) => { patch = p; return b },
      insert: async (row: Record<string, unknown>) => { db.inserts.push({ table, ...row }); return { error: null } },
      maybeSingle: async () => ({ data: { ...db.product }, error: null }),
      then: (resolve: (v: unknown) => void) => {
        if (patch) Object.assign(db.product, patch)
        resolve({ data: [{ id: 'p1' }], error: null })
      },
    }
    return b
  }
  return { getAdminClient: () => ({ from }) }
})
const products = await import('../app/admin/api/products/route')
const showReview = await import('../app/admin/api/show-review/route')

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://real.supabase.co'
  db.product = { sku: 'S1', name: 'Bear', manually_hidden: true, price_cents: 500 }
  db.audits = []
  db.inserts = []
})

describe('PATCH /admin/api/products audit', () => {
  it('logs product_visibility_changed when a product is shown', async () => {
    const res = await products.PATCH(new NextRequest('http://x/admin/api/products', { method: 'PATCH', body: JSON.stringify({ id: 'p1', manually_hidden: false }) }))
    expect(res.status).toBe(200)
    expect(db.audits).toEqual([
      expect.objectContaining({ action: 'product_visibility_changed', entity_id: 'p1', entity_label: 'S1', old_value: 'hidden', new_value: 'shown', performed_by: 'owner@example.com' }),
    ])
  })
  it('logs other edited fields as product_updated', async () => {
    await products.PATCH(new NextRequest('http://x/admin/api/products', { method: 'PATCH', body: JSON.stringify({ id: 'p1', name: 'Big Bear' }) }))
    expect(db.audits).toEqual([expect.objectContaining({ action: 'product_updated', old_value: '{"name":"Bear"}', new_value: '{"name":"Big Bear"}' })])
  })
})

describe('POST /admin/api/show-review', () => {
  const call = (body: unknown) => showReview.POST(new NextRequest('http://x/admin/api/show-review', { method: 'POST', body: JSON.stringify(body) }))
  it('records keep and reopen as audit rows', async () => {
    expect((await call({ id: 'p1', action: 'keep' })).status).toBe(200)
    expect((await call({ id: 'p1', action: 'reopen' })).status).toBe(200)
    expect(db.inserts.map((i) => [i.table, i.action, i.entity_label])).toEqual([
      ['audit_log', SHOW_REVIEW_KEEP, 'S1'],
      ['audit_log', SHOW_REVIEW_REOPEN, 'S1'],
    ])
  })
  it('rejects anything else', async () => {
    expect((await call({ id: 'p1', action: 'show' })).status).toBe(400)
    expect((await call({ action: 'keep' })).status).toBe(400)
  })
})
