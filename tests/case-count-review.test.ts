import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { caseCountOptions, casePiecesOf, checkCaseCountChange, withCaseCount } from '@/lib/case-count-review'

describe('casePiecesOf', () => {
  it('reads pieces per case from the pack spec', () => {
    expect(casePiecesOf('Snake - 12/pk 20bx/cs cs.240')).toBe(240)
    expect(casePiecesOf('Snake - 12/pk 42bx/cs cs.42')).toBe(504) // pack-sold: cs.N counts packs
    expect(casePiecesOf('No spec')).toBeNull()
  })
})

describe('withCaseCount', () => {
  it('keeps the description, pieces per pack and convention', () => {
    expect(withCaseCount('3D Printed Snakes 20" - 12/pk 20bx/cs cs.240', 216)).toBe('3D Printed Snakes 20" - 12/pk 18bx/cs cs.216')
    expect(withCaseCount('Thing - 12/pk 42bx/cs cs.42', 432)).toBe('Thing - 12/pk 36bx/cs cs.36')
    expect(withCaseCount('Bag - 12/pk 50bx/cs cs.50pk', 360)).toBe('Bag - 12/pk 30bx/cs cs.30pk')
    expect(withCaseCount('Ball - 1/pk 100bx/cs cs.100', 96)).toBe('Ball - 1/pk 96bx/cs cs.96')
  })
  it('refuses what it cannot build safely', () => {
    expect(withCaseCount('X - 6/pk 16bx/cs cs.96', 50)).toBeNull() // not whole packs
    expect(withCaseCount('No spec', 10)).toBeNull()
    expect(withCaseCount('Odd - 12/pk 20bx/cs cs.100', 120)).toBeNull() // inconsistent spec
    expect(withCaseCount('X - 6/pk 16bx/cs cs.96', 0)).toBeNull()
  })
})

describe('checkCaseCountChange', () => {
  const from = 'Snake - 12/pk 20bx/cs cs.240'
  it('accepts a change of the case part only', () => {
    expect(checkCaseCountChange(from, 'Snake - 12/pk 18bx/cs cs.216')).toEqual({ ok: true, pieces: 216 })
    expect(checkCaseCountChange(from, 'snake  - 12/pk 18bx/cs cs.216')).toMatchObject({ ok: true }) // spacing/case of the base
  })
  it('refuses anything else', () => {
    expect(checkCaseCountChange(from, 'Big Snake - 12/pk 18bx/cs cs.216')).toMatchObject({ ok: false, error: expect.stringMatching(/description/) })
    expect(checkCaseCountChange(from, 'Snake - 6/pk 36bx/cs cs.216')).toMatchObject({ ok: false, error: expect.stringMatching(/Pieces per pack must stay 12/) })
    expect(checkCaseCountChange(from, 'Snake - 12/pk 18bx/cs cs.200')).toMatchObject({ ok: false, error: expect.stringMatching(/add up/) })
    expect(checkCaseCountChange(from, 'Snake - 12/pk 20bx/cs cs.240')).toMatchObject({ ok: false, error: expect.stringMatching(/same case count/) })
    expect(checkCaseCountChange(from, 'Snake')).toMatchObject({ ok: false })
    expect(checkCaseCountChange('Snake', 'Snake - 12/pk 18bx/cs cs.216')).toMatchObject({ ok: false })
  })
})

describe('caseCountOptions', () => {
  it('groups distinct counts by source, skipping the current one and count-less evidence', () => {
    expect(
      caseCountOptions(
        [
          { source: 'Latest shipment', count: 216, detail: '' },
          { source: 'Earlier shipments', count: null, detail: '288, 216' },
          { source: 'QuickBooks', count: 288, detail: '' },
          { source: 'Photo label', count: 216, detail: '' },
          { source: 'Old name', count: 240, detail: '' },
        ],
        240,
      ),
    ).toEqual([
      { count: 216, sources: ['Latest shipment', 'Photo label'] },
      { count: 288, sources: ['QuickBooks'] },
    ])
  })
})

// The route against an in-memory DB: audit row first, rename via
// applyNameChange, row marked only on success; non-case changes refused.
const db = vi.hoisted(() => ({
  items: [] as Record<string, unknown>[],
  audit: [] as Record<string, unknown>[],
  log: [] as string[],
  renameOk: true,
}))
vi.mock('../lib/auth-server', () => ({ getActorEmail: async () => 'admin' }))
vi.mock('../lib/erply', () => ({ isConfigured: () => true }))
vi.mock('../lib/audit', () => ({ logAudit: async (e: Record<string, unknown>) => { db.audit.push(e); db.log.push(`audit:${e.action}`) } }))
vi.mock('../lib/product-name-fix', () => ({
  applyNameChange: async (a: { to: string }) => {
    db.log.push(`rename:${a.to}`)
    return db.renameOk
      ? [{ system: 'erply', status: 'updated + verified' }, { system: 'supabase', status: 'updated + verified' }]
      : [{ system: 'erply', status: 'SKIPPED — name differs' }]
  },
}))
vi.mock('../lib/supabase', () => {
  const from = (table: string) => {
    const filters: [string, unknown][] = []
    let patch: Record<string, unknown> | null = null
    const rows = () => db.items.filter((r) => filters.every(([c, v]) => r[c] === v))
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => { filters.push([c, v]); return b },
      update: (p: Record<string, unknown>) => { patch = p; return b },
      insert: async (row: Record<string, unknown>) => { db.audit.push(row); db.log.push(`insert:${table}:${row.action}`); return { error: null } },
      maybeSingle: async () => ({ data: rows()[0] ? { ...rows()[0] } : null, error: null }),
      then: (resolve: (v: unknown) => void) => {
        const r = rows()
        if (patch) { r.forEach((x) => Object.assign(x, patch)); db.log.push(`update:${table}`) }
        resolve({ data: r, error: null })
      },
    }
    return b
  }
  return { getAdminClient: () => ({ from }) }
})

const { POST } = await import('../app/admin/api/case-count-review/route')
const call = (body: unknown) => POST(new NextRequest('http://x/admin/api/case-count-review', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://real.supabase.co'
  db.log = []
  db.audit = []
  db.renameOk = true
  db.items = [{ id: 'r1', batch: 'b', product_id: 'p1', sku: 'S1', current_name: 'Snake - 12/pk 20bx/cs cs.240', status: 'pending' }]
})

describe('POST /admin/api/case-count-review', () => {
  it('writes the audit row, renames, then marks approved', async () => {
    const res = await call({ id: 'r1', action: 'approve', name: 'Snake - 12/pk 18bx/cs cs.216' })
    expect(res.status).toBe(200)
    expect(db.log).toEqual([
      'insert:audit_log:product_name_change_started',
      'rename:Snake - 12/pk 18bx/cs cs.216',
      'audit:product_name_changed',
      'update:case_count_review_items',
    ])
    expect(db.items[0]).toMatchObject({ status: 'approved', decided_name: 'Snake - 12/pk 18bx/cs cs.216' })
  })

  it('refuses a description change before touching anything', async () => {
    const res = await call({ id: 'r1', action: 'approve', name: 'Big Snake - 12/pk 18bx/cs cs.216' })
    expect(res.status).toBe(400)
    expect(db.log).toEqual([])
  })

  it('leaves the row pending with the result when a system refuses', async () => {
    db.renameOk = false
    const res = await call({ id: 'r1', action: 'approve', name: 'Snake - 12/pk 18bx/cs cs.216' })
    expect(res.status).toBe(409)
    expect(db.items[0]).toMatchObject({ status: 'pending', result: 'erply: SKIPPED — name differs' })
  })

  it('"Name is right" keeps it and records that', async () => {
    const res = await call({ id: 'r1', action: 'skip' })
    expect(res.status).toBe(200)
    expect(db.items[0].status).toBe('skipped')
    expect(db.audit.map((a) => a.action)).toEqual(['case_count_review_kept'])
  })
})
