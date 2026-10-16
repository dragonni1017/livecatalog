import { describe, expect, it } from 'vitest'
import { attributeOrder, groupByRep, periodSince, summarize, type AttributableOrder } from '../lib/rep-attribution'

const reps = [
  { id: 'u-janet', email: 'janetgarcia@ly-usa.com' },
  { id: 'u-cong', email: 'conglai@ly-usa.com' },
]
let n = 0
const order = (over: Partial<AttributableOrder>): AttributableOrder => ({
  id: `o${++n}`,
  reference_code: `ORD-${n}`,
  created_at: '2026-09-01T12:00:00Z',
  status: 'new',
  subtotal_cents: 10_000,
  placed_by_rep: null,
  rep_user_id: null,
  ...over,
})

describe('attributeOrder', () => {
  it('credits the account whose email matches placed_by_rep (case-insensitive)', () => {
    expect(attributeOrder(order({ placed_by_rep: ' JanetGarcia@ly-usa.com ' }), reps)).toEqual({ kind: 'rep', repId: 'u-janet' })
  })
  it('falls back to the signed-in rep', () => {
    expect(attributeOrder(order({ rep_user_id: 'u-cong' }), reps)).toEqual({ kind: 'rep', repId: 'u-cong' })
  })
  it('the chosen rep wins over the signed-in one if they ever differ', () => {
    expect(attributeOrder(order({ placed_by_rep: 'janetgarcia@ly-usa.com', rep_user_id: 'u-cong' }), reps)).toEqual({ kind: 'rep', repId: 'u-janet' })
  })
  it('a free-text name with no account is unlinked; nothing at all is none', () => {
    expect(attributeOrder(order({ placed_by_rep: 'Alina' }), reps)).toEqual({ kind: 'unlinked', name: 'Alina' })
    expect(attributeOrder(order({ rep_user_id: 'deleted-rep' }), reps)).toEqual({ kind: 'none' })
    expect(attributeOrder(order({}), reps)).toEqual({ kind: 'none' })
  })
  it('a name typed as the signed-in rep still credits the account', () => {
    expect(attributeOrder(order({ placed_by_rep: 'Cong', rep_user_id: 'u-cong' }), reps)).toEqual({ kind: 'rep', repId: 'u-cong' })
  })
})

describe('summarize', () => {
  it('splits open, converted and lost, with values and the latest date', () => {
    const s = summarize([
      order({ status: 'new', subtotal_cents: 1000, created_at: '2026-09-01T00:00:00Z' }),
      order({ status: 'contacted', subtotal_cents: 2000, created_at: '2026-09-03T00:00:00Z' }),
      order({ status: 'converted', subtotal_cents: 5000, created_at: '2026-09-02T00:00:00Z' }),
      order({ status: 'lost', subtotal_cents: 700, created_at: '2026-08-01T00:00:00Z' }),
    ])
    expect(s).toEqual({
      orders: 4,
      quoteValueCents: 8700,
      converted: 1,
      convertedValueCents: 5000,
      open: 2,
      openValueCents: 3000,
      lost: 1,
      lastOrderAt: '2026-09-03T00:00:00Z',
    })
  })
  it('empty', () => {
    expect(summarize([]).lastOrderAt).toBeNull()
  })
})

describe('groupByRep', () => {
  it('every rep gets a row (even with no orders); legacy names are grouped', () => {
    const { byRep, unlinked } = groupByRep(
      [order({ placed_by_rep: 'janetgarcia@ly-usa.com' }), order({ placed_by_rep: 'Alina' }), order({ placed_by_rep: 'Alina' }), order({})],
      reps,
    )
    expect(byRep.get('u-janet')).toHaveLength(1)
    expect(byRep.get('u-cong')).toHaveLength(0)
    expect(unlinked.get('Alina')).toHaveLength(2)
  })
})

describe('periodSince', () => {
  const now = Date.parse('2026-10-16T12:00:00Z')
  it('known periods, else all time', () => {
    expect(periodSince('30', now)).toEqual({ key: '30', since: '2026-09-16T12:00:00.000Z' })
    expect(periodSince('7', now)).toEqual({ key: 'all', since: null })
    expect(periodSince(undefined, now)).toEqual({ key: 'all', since: null })
  })
})
