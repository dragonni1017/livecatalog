import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { parseNameReviewBody, renameSucceeded, summarizeRename } from '@/lib/name-review'
import type { NameChangeRow } from '@/lib/product-name-fix'

const row = (system: NameChangeRow['system'], status: string): NameChangeRow => ({ system, id: 'x', oldName: 'a', newName: 'b', status })

describe('parseNameReviewBody', () => {
  it('reads approve with a tidied name, skip and reopen', () => {
    expect(parseNameReviewBody({ id: 'a', action: 'approve', name: '  New   Name  ' })).toEqual({ id: 'a', action: 'approve', name: 'New Name' })
    expect(parseNameReviewBody({ id: 'a', action: 'skip' })).toEqual({ id: 'a', action: 'skip' })
    expect(parseNameReviewBody({ id: 'a', action: 'reopen' })).toEqual({ id: 'a', action: 'reopen' })
  })
  it('rejects a missing id, bad action, empty or overlong name', () => {
    expect(parseNameReviewBody({ action: 'skip' })).toHaveProperty('error')
    expect(parseNameReviewBody({ id: 'a', action: 'rename' })).toHaveProperty('error')
    expect(parseNameReviewBody({ id: 'a', action: 'approve', name: '  ' })).toHaveProperty('error')
    expect(parseNameReviewBody({ id: 'a', action: 'approve', name: 'x'.repeat(201) })).toHaveProperty('error')
  })
})

describe('renameSucceeded', () => {
  it('is done when the catalog has the new name and nothing failed', () => {
    expect(renameSucceeded([row('erply', 'updated + verified'), row('woocommerce', 'SKIPPED — WooCommerce not configured here'), row('supabase', 'updated + verified')])).toBe(true)
    expect(renameSucceeded([row('erply', 'already correct'), row('woocommerce', 'SKIPPED — SKU not in WooCommerce'), row('supabase', 'updated + verified')])).toBe(true)
  })
  it('is not done when something failed, a name differed, or the catalog was not written', () => {
    expect(renameSucceeded([row('erply', 'FAILED — boom'), row('woocommerce', 'SKIPPED — an earlier system failed'), row('supabase', 'SKIPPED — an earlier system failed')])).toBe(false)
    expect(renameSucceeded([row('erply', 'SKIPPED — name differs from expected'), row('woocommerce', 'already correct'), row('supabase', 'updated + verified')])).toBe(false)
    expect(renameSucceeded([row('erply', 'updated + verified'), row('woocommerce', 'updated + verified'), row('supabase', 'SKIPPED — SKU not in catalog')])).toBe(false)
  })
  it('summarizes each system', () => {
    expect(summarizeRename([row('erply', 'updated + verified'), row('supabase', 'already correct')])).toBe('erply: updated + verified; supabase: already correct')
  })
})

// ── The route, with the rename itself faked ──────────────────────────────────

const st = vi.hoisted(() => ({
  items: [] as Record<string, unknown>[],
  audit: [] as Record<string, unknown>[],
  log: [] as string[],
  renameResult: [] as unknown[],
  renameCalls: [] as unknown[],
}))

vi.mock('../lib/auth-server', () => ({ getActorEmail: async () => 'admin' }))
vi.mock('../lib/erply', () => ({ isConfigured: () => true }))
vi.mock('../lib/audit', () => ({ logAudit: async (e: Record<string, unknown>) => { st.audit.push(e); st.log.push(`audit:${e.action}`) } }))
vi.mock('../lib/product-name-fix', () => ({
  applyNameChange: async (input: unknown) => { st.renameCalls.push(input); st.log.push('rename'); return st.renameResult },
}))
vi.mock('../lib/supabase', () => {
  const from = (table: string) => {
    const filters: [string, unknown][] = []
    let patch: Record<string, unknown> | null = null
    const src = () => (table === 'name_review_items' ? st.items : [])
    const match = (r: Record<string, unknown>) => filters.every(([c, v]) => r[c] === v)
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => { filters.push([c, v]); return b },
      update: (p: Record<string, unknown>) => { patch = p; return b },
      insert: async (r: Record<string, unknown>) => { st.audit.push(r); st.log.push(`insert:${table}:${r.action}`); return { error: null } },
      maybeSingle: async () => { const r = src().filter(match)[0]; return { data: r ? { ...r } : null, error: null } },
      then: (resolve: (v: unknown) => void) => {
        const rows = src().filter(match)
        if (patch) { rows.forEach((r) => Object.assign(r, patch)); if (rows.length) st.log.push(`update:${table}`) }
        resolve({ data: rows, error: null })
      },
    }
    return b
  }
  return { getAdminClient: () => ({ from }) }
})

const { POST } = await import('../app/admin/api/name-review/route')
const call = (body: unknown) => POST(new NextRequest('http://x/admin/api/name-review', { method: 'POST', body: JSON.stringify(body) }))
const OKROWS = [row('erply', 'updated + verified'), row('woocommerce', 'SKIPPED — WooCommerce not configured here'), row('supabase', 'updated + verified')]

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://real.supabase.co'
  st.items = [{ id: 'n1', batch: 'b', product_id: 'p1', sku: 'S1', current_name: 'Erase - 12/pk 12bx/cs cs.144', status: 'pending' }]
  st.audit = []
  st.log = []
  st.renameCalls = []
  st.renameResult = OKROWS
})

describe('POST /admin/api/name-review', () => {
  it('approve: audit row first, then the guarded rename, then the result, then marks the row', async () => {
    const res = await call({ id: 'n1', action: 'approve', name: 'Eraser - 12/pk 12bx/cs cs.144' })
    expect(res.status).toBe(200)
    expect(st.log).toEqual(['insert:audit_log:product_name_change_started', 'rename', 'audit:product_name_changed', 'update:name_review_items'])
    expect(st.renameCalls[0]).toMatchObject({ sku: 'S1', expect: 'Erase - 12/pk 12bx/cs cs.144', to: 'Eraser - 12/pk 12bx/cs cs.144', apply: true })
    expect(st.items[0]).toMatchObject({ status: 'approved', decided_name: 'Eraser - 12/pk 12bx/cs cs.144' })
  })

  it('a failed rename stays pending with the result shown', async () => {
    st.renameResult = [row('erply', 'SKIPPED — name differs from expected'), row('woocommerce', 'already correct'), row('supabase', 'updated + verified')]
    const res = await call({ id: 'n1', action: 'approve', name: 'Eraser - 12/pk 12bx/cs cs.144' })
    expect(res.status).toBe(409)
    expect(st.items[0].status).toBe('pending')
    expect(String(st.items[0].result)).toContain('name differs')
  })

  it('refuses a change to the pack part without renaming anything', async () => {
    const res = await call({ id: 'n1', action: 'approve', name: 'Eraser - 24/pk 6bx/cs cs.144' })
    expect(res.status).toBe(400)
    expect(st.log).toEqual([])
  })

  it('refuses the same name and an already-decided row', async () => {
    expect((await call({ id: 'n1', action: 'approve', name: 'Erase - 12/pk 12bx/cs cs.144' })).status).toBe(400)
    st.items[0].status = 'approved'
    expect((await call({ id: 'n1', action: 'approve', name: 'X - 12/pk 12bx/cs cs.144' })).status).toBe(409)
    expect(st.renameCalls).toHaveLength(0)
  })

  it('skip and reopen never rename', async () => {
    expect((await call({ id: 'n1', action: 'skip' })).status).toBe(200)
    expect(st.items[0].status).toBe('skipped')
    expect((await call({ id: 'n1', action: 'reopen' })).status).toBe(200)
    expect(st.items[0].status).toBe('pending')
    expect(st.renameCalls).toHaveLength(0)
  })
})
