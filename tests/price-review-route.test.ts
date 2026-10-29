import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// POST /admin/api/price-review against an in-memory stand-in for the DB.
// Proves: approve writes the audit row before the price; a price that changed
// mid-way writes nothing and records an "aborted" audit row; and a retry after
// an earlier approve (price already set, row not marked) only marks the row.

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Record<string, unknown>[]>,
  log: [] as string[],
  failItemUpdateOnce: false,
  // When set, an edit to the product lands right after the audit row is written.
  priceChangesAfterAudit: null as number | null,
}))

vi.mock('../lib/audit', () => ({
  logAudit: async (e: Record<string, unknown>) => {
    db.tables.audit_log.push(e)
    db.log.push(`audit:${e.action}`)
  },
}))

vi.mock('../lib/supabase', () => {
  const from = (table: string) => {
    const filters: [string, unknown, 'eq' | 'is'][] = []
    let patch: Record<string, unknown> | null = null
    const match = (r: Record<string, unknown>) =>
      filters.every(([c, v, op]) => (op === 'is' ? (r[c] ?? null) === v : r[c] === v))
    const run = () => {
      const rows = db.tables[table].filter(match)
      if (patch) {
        if (table === 'price_review_items' && db.failItemUpdateOnce) {
          db.failItemUpdateOnce = false
          return { data: null, error: { message: 'boom' } }
        }
        rows.forEach((r) => Object.assign(r, patch))
        if (rows.length) db.log.push(`update:${table}`)
      }
      return { data: rows, error: null }
    }
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => { filters.push([c, v, 'eq']); return b },
      is: (c: string, v: unknown) => { filters.push([c, v, 'is']); return b },
      update: (p: Record<string, unknown>) => { patch = p; return b },
      insert: async (row: Record<string, unknown>) => {
        db.tables[table].push(row)
        db.log.push(`insert:${table}:${String(row.action ?? '')}`)
        if (table === 'audit_log' && db.priceChangesAfterAudit != null) {
          db.tables.products[0].price_cents = db.priceChangesAfterAudit
          db.priceChangesAfterAudit = null
        }
        return { error: null }
      },
      // A copy, like a real DB: later writes must not change what the route already read.
      maybeSingle: async () => {
        const row = db.tables[table].filter(match)[0]
        return { data: row ? { ...row } : null, error: null }
      },
      then: (resolve: (v: unknown) => void) => resolve(run()),
    }
    return b
  }
  return { getAdminClient: () => ({ from }) }
})

const { POST } = await import('../app/admin/api/price-review/route')
const call = (body: unknown) =>
  POST(new NextRequest('http://x/admin/api/price-review', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://real.supabase.co'
  db.log = []
  db.failItemUpdateOnce = false
  db.priceChangesAfterAudit = null
  db.tables = {
    price_review_items: [{ id: 'r1', batch: 'b', product_id: 'p1', sku: 'S1', status: 'pending' }],
    products: [{ id: 'p1', sku: 'S1', name: 'Thing', price_cents: 500, held_price_cents: null }],
    audit_log: [],
  }
})

describe('approve', () => {
  it('writes the audit row first, then the price and hold, then marks the row', async () => {
    const res = await call({ id: 'r1', action: 'approve', cents: 950 })
    expect(res.status).toBe(200)
    expect(db.log).toEqual(['insert:audit_log:product_price_held', 'update:products', 'update:price_review_items'])
    expect(db.tables.products[0]).toMatchObject({ price_cents: 950, held_price_cents: 950 })
    expect(db.tables.price_review_items[0]).toMatchObject({ status: 'approved', decided_cents: 950 })
  })

  it('records an aborted audit row and writes nothing when the price changed mid-way', async () => {
    // Another edit lands between the read and the guarded update.
    db.priceChangesAfterAudit = 600
    const res = await call({ id: 'r1', action: 'approve', cents: 950 })
    expect(res.status).toBe(409)
    expect(db.log).toEqual(['insert:audit_log:product_price_held', 'audit:product_price_hold_aborted'])
    expect(db.tables.products[0]).toMatchObject({ price_cents: 600, held_price_cents: null })
    expect(db.tables.price_review_items[0].status).toBe('pending')
  })

  it('a retry after the row failed to be marked only marks it (no second audit, no second write)', async () => {
    db.failItemUpdateOnce = true
    const first = await call({ id: 'r1', action: 'approve', cents: 950 })
    expect(first.status).toBe(500)
    expect(db.tables.products[0]).toMatchObject({ price_cents: 950, held_price_cents: 950 })
    expect(db.tables.price_review_items[0].status).toBe('pending')

    db.log = []
    const retry = await call({ id: 'r1', action: 'approve', cents: 950 })
    expect(retry.status).toBe(200)
    expect(db.log).toEqual(['update:price_review_items'])
    expect(db.tables.audit_log.filter((a) => a.action === 'product_price_held')).toHaveLength(1)
    expect(db.tables.price_review_items[0].status).toBe('approved')
  })

  it('refuses a row that was already decided', async () => {
    db.tables.price_review_items[0].status = 'approved'
    const res = await call({ id: 'r1', action: 'approve', cents: 950 })
    expect(res.status).toBe(409)
    expect(db.log).toEqual([])
  })
})

describe('skip / reopen', () => {
  it('skip leaves the price alone', async () => {
    const res = await call({ id: 'r1', action: 'skip' })
    expect(res.status).toBe(200)
    expect(db.tables.products[0].price_cents).toBe(500)
    expect(db.tables.price_review_items[0].status).toBe('skipped')
    const back = await call({ id: 'r1', action: 'reopen' })
    expect(back.status).toBe(200)
    expect(db.tables.price_review_items[0].status).toBe('pending')
  })
})
