import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { offersRename, parseOwnerQuestionBody } from '@/lib/owner-questions'
import { buildWaitingQueues } from '@/lib/waiting-queues'

describe('parseOwnerQuestionBody', () => {
  it('accepts the four actions', () => {
    expect(parseOwnerQuestionBody({ id: 'q1', action: 'answer', answer: ' 30 packs ' })).toEqual({ id: 'q1', action: 'answer', answer: '30 packs' })
    expect(parseOwnerQuestionBody({ id: 'q1', action: 'done' })).toEqual({ id: 'q1', action: 'done' })
    expect(parseOwnerQuestionBody({ id: 'q1', action: 'reopen' })).toEqual({ id: 'q1', action: 'reopen' })
    expect(parseOwnerQuestionBody({ id: 'q1', action: 'rename', name: ' Circle   Flower Holder ' })).toEqual({ id: 'q1', action: 'rename', name: 'Circle Flower Holder' })
  })
  it('rejects empty or unknown input', () => {
    expect(parseOwnerQuestionBody({ id: 'q1', action: 'answer', answer: '  ' })).toHaveProperty('error')
    expect(parseOwnerQuestionBody({ id: 'q1', action: 'rename', name: '' })).toHaveProperty('error')
    expect(parseOwnerQuestionBody({ id: 'q1', action: 'delete' })).toHaveProperty('error')
    expect(parseOwnerQuestionBody({ action: 'done' })).toHaveProperty('error')
  })
  it('offers a rename only for name and photo kinds', () => {
    expect(offersRename('Name typo')).toBe(true)
    expect(offersRename('QuickBooks fix')).toBe(false)
  })
})

describe('Waiting page queue', () => {
  it('lists open owner questions for the Owner', () => {
    const q = buildWaitingQueues({
      nowIso: '2026-11-06T20:00:00Z', quotesToAnswer: [], ordersForQuickBooks: [], creditApplications: [], resaleCertificates: [],
      stagedShipments: [], caseCounts: [], names: [], prices: [], pricesForErply: 0, hiddenSearched: [], photosToTake: 0,
      ownerQuestions: ['2026-11-06T18:00:00Z', '2026-11-06T18:00:00Z'],
    })
    expect(q).toEqual([expect.objectContaining({ key: 'owner-questions', who: 'Owner', countText: '2 questions', href: '/admin/owner-questions' })])
  })
})

// The route: every change writes an audit row first; rename only queues a
// name_review_items row and never renames anything itself.
const db = vi.hoisted(() => ({
  q: {} as Record<string, unknown>,
  product: { id: 'p1', sku: 'F288022', name: 'Cirlce Flower Holder - 12/pk 1bx/cs cs.12' } as Record<string, unknown>,
  log: [] as string[],
  rows: [] as Record<string, unknown>[],
}))
vi.mock('../lib/auth-server', () => ({ getSessionUser: async () => ({ email: 'owner@example.com' }) }))
vi.mock('../lib/supabase', () => {
  const from = (table: string) => {
    let patch: Record<string, unknown> | null = null
    const b: Record<string, unknown> = {
      select: () => b,
      eq: () => b,
      update: (p: Record<string, unknown>) => { patch = p; return b },
      insert: async (row: Record<string, unknown>) => { db.log.push(`insert:${table}:${row.action}`); db.rows.push(row); return { error: null } },
      upsert: async (rows: Record<string, unknown>[]) => { db.log.push(`upsert:${table}`); db.rows.push(...rows); return { error: null } },
      maybeSingle: async () => ({ data: table === 'products' ? { ...db.product } : { ...db.q }, error: null }),
      then: (resolve: (v: unknown) => void) => {
        if (patch) { Object.assign(db.q, patch); db.log.push(`update:${table}:${patch.status}`) }
        resolve({ data: null, error: null })
      },
    }
    return b
  }
  return { getAdminClient: () => ({ from }) }
})
const { POST } = await import('../app/admin/api/owner-questions/route')
const call = (body: unknown) => POST(new NextRequest('http://x/admin/api/owner-questions', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  db.q = { id: 'q1', sku: 'F288022', kind: 'Name typo', product_id: 'p1', answer: null, status: 'open' }
  db.log = []
  db.rows = []
})

describe('POST /admin/api/owner-questions', () => {
  it('saves an answer, audit first', async () => {
    expect((await call({ id: 'q1', action: 'answer', answer: 'Yes, fix it' })).status).toBe(200)
    expect(db.log).toEqual(['insert:audit_log:owner_question_answered', 'update:owner_questions:answered'])
    expect(db.q).toMatchObject({ answer: 'Yes, fix it', status: 'answered', answered_by: 'owner@example.com' })
  })
  it('rename queues a Name review row and marks the question done, without renaming', async () => {
    const res = await call({ id: 'q1', action: 'rename', name: 'Circle Flower Holder - 12/pk 1bx/cs cs.12' })
    expect(res.status).toBe(200)
    expect(db.log).toEqual(['insert:audit_log:owner_question_sent_to_name_review', 'upsert:name_review_items', 'update:owner_questions:done'])
    expect(db.rows[1]).toMatchObject({ batch: 'owner-questions', product_id: 'p1', current_name: 'Cirlce Flower Holder - 12/pk 1bx/cs cs.12', suggested_name: 'Circle Flower Holder - 12/pk 1bx/cs cs.12' })
  })
  it('refuses a rename to the same name, or for a SKU not in the catalog', async () => {
    expect((await call({ id: 'q1', action: 'rename', name: db.product.name })).status).toBe(400)
    db.q.product_id = null
    expect((await call({ id: 'q1', action: 'rename', name: 'X' })).status).toBe(409)
    expect(db.log).toEqual([])
  })
})
