import { describe, it, expect } from 'vitest'
import { parseDismissBody, dismissBlocker, isDismissReason, DISMISS_REASONS } from '@/lib/order-dismiss'

describe('parseDismissBody', () => {
  it('reads a dismiss with a valid reason', () => {
    expect(parseDismissBody({ id: ' abc ', reason: 'test' })).toEqual({ kind: 'dismiss', id: 'abc', reason: 'test' })
    expect(parseDismissBody({ id: 'abc', reason: 'spam' })).toEqual({ kind: 'dismiss', id: 'abc', reason: 'spam' })
  })

  it('reads an undo', () => {
    expect(parseDismissBody({ id: 'abc', undo: true })).toEqual({ kind: 'undo', id: 'abc' })
  })

  it('rejects a missing id, a bad reason, and undo with a reason', () => {
    expect(parseDismissBody({ reason: 'test' })).toHaveProperty('error')
    expect(parseDismissBody({ id: 'abc' })).toHaveProperty('error')
    expect(parseDismissBody({ id: 'abc', reason: 'lost' })).toHaveProperty('error')
    expect(parseDismissBody({ id: 'abc', undo: true, reason: 'test' })).toHaveProperty('error')
    expect(parseDismissBody({ id: 'abc', undo: 'yes' })).toHaveProperty('error')
    expect(parseDismissBody(null)).toHaveProperty('error')
  })

  it('accepts exactly the reasons the migration allows', () => {
    expect([...DISMISS_REASONS]).toEqual(['test', 'duplicate', 'spam'])
    expect(isDismissReason('duplicate')).toBe(true)
    expect(isDismissReason('lost')).toBe(false)
  })
})

describe('dismissBlocker', () => {
  const base = { status: 'new' as const, entered_in_qb: false, dismissed_at: null }

  it('allows a new order that is not in QuickBooks', () => {
    expect(dismissBlocker(base)).toBeNull()
  })

  it('blocks an order that has left new (so no status email or stock path is skipped)', () => {
    expect(dismissBlocker({ ...base, status: 'contacted' })).not.toBeNull()
    expect(dismissBlocker({ ...base, status: 'converted' })).not.toBeNull()
    expect(dismissBlocker({ ...base, status: 'lost' })).not.toBeNull()
  })

  it('blocks an order already entered in QuickBooks', () => {
    expect(dismissBlocker({ ...base, entered_in_qb: true })).not.toBeNull()
  })

  it('blocks an order that is already dismissed', () => {
    expect(dismissBlocker({ ...base, dismissed_at: '2026-10-29T00:00:00Z' })).not.toBeNull()
  })
})
