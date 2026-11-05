import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { cleanupHints, describeHint, type CleanupOrder } from '@/lib/order-cleanup'

const o = (id: string, email: string | null, created_at: string, extra: Partial<CleanupOrder> = {}): CleanupOrder => ({
  id,
  reference_code: `ORD-${id}`,
  status: 'new',
  customer_email: email,
  subtotal_cents: 1000,
  created_at,
  dismissed_at: null,
  ...extra,
})

describe('cleanupHints', () => {
  it('finds later quotes from the same email, case-insensitively, oldest first', () => {
    const h = cleanupHints([
      o('1', 'A@x.com', '2026-07-01T00:00:00Z', { subtotal_cents: 500 }),
      o('3', 'a@x.com ', '2026-09-01T00:00:00Z', { status: 'converted', subtotal_cents: 700 }),
      o('2', 'a@x.com', '2026-08-01T00:00:00Z', { subtotal_cents: 600 }),
      o('4', 'b@x.com', '2026-10-01T00:00:00Z'),
    ])
    expect(h.get('1')!.later.map((l) => l.reference_code)).toEqual(['ORD-2', 'ORD-3'])
    expect(h.get('3')!.later).toEqual([])
    expect(h.get('4')!.later).toEqual([])
    expect(describeHint(h.get('1'))).toBe('Same customer sent ORD-2 (new), ORD-3 (converted) later')
    expect(describeHint(h.get('4'))).toBeNull()
  })

  it('flags a same-total request within 2 days, and ignores dismissed ones and blank emails', () => {
    const h = cleanupHints([
      o('1', 'a@x.com', '2026-07-01T00:00:00Z'),
      o('2', 'a@x.com', '2026-07-02T12:00:00Z'),
      o('3', 'a@x.com', '2026-07-01T05:00:00Z', { dismissed_at: '2026-07-03T00:00:00Z' }),
      o('4', null, '2026-07-01T00:00:00Z'),
      o('5', null, '2026-07-01T01:00:00Z'),
    ])
    expect(h.get('1')!.possibleDuplicateOf).toBe('ORD-2')
    expect(h.get('1')!.later.map((l) => l.id)).toEqual(['2'])
    expect(h.get('4')).toEqual({ later: [], possibleDuplicateOf: null })
  })
})

// PATCH /admin/api/orders { notify: false }: status and audit still written,
// only the customer email is skipped; converted still queues QuickBooks.
const db = vi.hoisted(() => ({ log: [] as string[], audits: [] as Record<string, unknown>[] }))
vi.mock('../lib/order-emails', () => ({ notifyOrderStatusChange: async () => { db.log.push('email') } }))
vi.mock('../lib/audit', () => ({ logAudit: async (e: Record<string, unknown>) => { db.audits.push(e); db.log.push(`audit:${e.action}`) } }))
vi.mock('../lib/supabase', () => {
  const from = (table: string) => {
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      single: async () => ({ data: { status: 'new', entered_in_qb: false, reference_code: 'ORD-1', stock_decremented_at: '2026-01-01', first_response_at: null }, error: null }),
      update: () => { db.log.push(`update:${table}`); return b },
      insert: async () => { db.log.push(`insert:${table}`); return { error: null } },
      then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    }
    return b
  }
  return { getAdminClient: () => ({ from, rpc: async () => ({ error: null }) }) }
})
const { PATCH } = await import('../app/admin/api/orders/route')
const call = (body: unknown) => PATCH(new NextRequest('http://x/admin/api/orders', { method: 'PATCH', body: JSON.stringify(body) }))

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://real.supabase.co'
  db.log = []
  db.audits = []
})

describe('PATCH /admin/api/orders notify', () => {
  it('emails by default', async () => {
    expect((await call({ id: 'o1', status: 'lost' })).status).toBe(200)
    expect(db.log).toContain('email')
  })
  it('notify:false skips only the email and says so in the audit', async () => {
    expect((await call({ id: 'o1', status: 'lost', notify: false })).status).toBe(200)
    expect(db.log).not.toContain('email')
    expect(db.log).toContain('update:order_requests')
    expect(db.audits[0]).toMatchObject({ action: 'order_status_change', new_value: 'lost (no customer email)' })
  })
  it('converted with notify:false still queues QuickBooks', async () => {
    await call({ id: 'o1', status: 'converted', notify: false })
    expect(db.log).not.toContain('email')
    expect(db.log).toContain('insert:qb_sync_queue')
  })
  it('rejects a non-boolean notify', async () => {
    expect((await call({ id: 'o1', status: 'lost', notify: 'no' })).status).toBe(400)
  })
})
