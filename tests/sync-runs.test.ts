import { describe, expect, it, vi } from 'vitest'
import { buildSyncRunRow, MAX_STORED_ERRORS, recordSyncRun, syncHealth } from '../lib/sync-runs'

const T0 = Date.parse('2026-10-16T08:00:00Z')
const ok = { inserted: 2, updated: 3215, deactivated: 0, errors: [] }

describe('buildSyncRunRow', () => {
  it('a clean run is ok, with counts and duration', () => {
    const r = buildSyncRunRow({ source: 'cron', startedAt: T0, finishedAt: T0 + 41_500, result: ok, details: { stockSync: { adjusted: 65 } } })
    expect(r).toMatchObject({ source: 'cron', status: 'ok', inserted: 2, updated: 3215, error_count: 0, errors: null, duration_ms: 41_500, message: null })
    expect(r.started_at).toBe('2026-10-16T08:00:00.000Z')
  })
  it('row errors make it partial, and only the first ones are stored', () => {
    const errors = Array.from({ length: 120 }, (_, i) => ({ row: i, sku: `S${i}`, message: 'duplicate key value violates unique constraint "products_pkey"' }))
    const r = buildSyncRunRow({ source: 'cron', startedAt: T0, result: { ...ok, errors } })
    expect(r.status).toBe('partial')
    expect(r.error_count).toBe(120)
    expect(r.errors).toHaveLength(MAX_STORED_ERRORS)
  })
  it('a failed sub-step (e.g. stock sync) makes it partial', () => {
    expect(buildSyncRunRow({ source: 'cron', startedAt: T0, result: ok, details: { stockSync: { error: 'timeout' } } }).status).toBe('partial')
  })
  it('an exception is an error, with the message kept', () => {
    const r = buildSyncRunRow({ source: 'manual', startedAt: T0, failure: new Error('Erply 401: session expired') })
    expect(r).toMatchObject({ status: 'error', message: 'Erply 401: session expired', updated: 0 })
  })
  it('a skipped run says why', () => {
    expect(buildSyncRunRow({ source: 'cron', startedAt: T0, skippedReason: 'Erply not configured' })).toMatchObject({ status: 'skipped', message: 'Erply not configured' })
  })
})

describe('syncHealth', () => {
  const run = (hoursAgo: number, status: 'ok' | 'partial' | 'error' | 'skipped', source: 'cron' | 'manual' = 'cron') => ({
    source,
    status,
    started_at: new Date(T0 - hoursAgo * 3_600_000).toISOString(),
  })
  it('unknown until the first nightly run is recorded', () => {
    expect(syncHealth([], T0).level).toBe('unknown')
    expect(syncHealth([run(1, 'ok', 'manual')], T0).level).toBe('unknown') // manual runs don't count
  })
  it('ok when last night ran cleanly', () => {
    expect(syncHealth([run(2, 'ok')], T0).level).toBe('ok')
  })
  it('warns when the latest nightly run was not clean', () => {
    const h = syncHealth([run(2, 'partial'), run(26, 'ok')], T0)
    expect(h.level).toBe('warning')
    expect(h.message).toContain('partial')
  })
  it('warns when a night was missed (no clean run in 26h)', () => {
    const h = syncHealth([run(50, 'ok')], T0)
    expect(h.level).toBe('warning')
    expect(h.message).toContain('50 hours')
  })
})

describe('recordSyncRun', () => {
  it('never throws, even if the insert blows up', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const db = { from: () => { throw new Error('db down') } } as never
    await expect(recordSyncRun(db, { source: 'cron', startedAt: T0, result: ok })).resolves.toBeUndefined()
  })
  it('inserts the built row', async () => {
    const insert = vi.fn(async () => ({ error: null }))
    const db = { from: (t: string) => (t === 'sync_runs' ? { insert } : null) } as never
    await recordSyncRun(db, { source: 'manual', startedAt: T0, finishedAt: T0 + 1000, result: ok })
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ source: 'manual', status: 'ok', updated: 3215, duration_ms: 1000 }))
  })
})
