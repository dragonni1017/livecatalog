import { describe, it, expect } from 'vitest'
import { chooseAutoOwner, creditedRepEmail, findRep, ownerOf, type PreviousOrder } from '@/lib/order-owner'

const reps = [
  { id: 'r1', email: 'ann@ly-usa.com' },
  { id: 'r2', email: 'bob@ly-usa.com' },
]
const blank = { placed_by_rep: null, rep_user_id: null, assigned_rep_email: null }
const prev = (created_at: string, o: Partial<PreviousOrder>): PreviousOrder => ({ ...blank, created_at, ...o })

describe('findRep / creditedRepEmail / ownerOf', () => {
  it('matches rep emails case-insensitively and ignores non-reps', () => {
    expect(findRep('ANN@ly-usa.com', reps)?.id).toBe('r1')
    expect(findRep('someone@example.com', reps)).toBeUndefined()
    expect(findRep(null, reps)).toBeUndefined()
  })

  it('credits the rep the same way as rep attribution', () => {
    expect(creditedRepEmail({ placed_by_rep: 'bob@ly-usa.com', rep_user_id: null }, reps)).toBe('bob@ly-usa.com')
    expect(creditedRepEmail({ placed_by_rep: null, rep_user_id: 'r1' }, reps)).toBe('ann@ly-usa.com')
    expect(creditedRepEmail({ placed_by_rep: 'Cong', rep_user_id: null }, reps)).toBeNull()
  })

  it('prefers a still-valid assigned owner, else the credited rep', () => {
    expect(ownerOf({ ...blank, assigned_rep_email: 'bob@ly-usa.com', rep_user_id: 'r1' }, reps)).toBe('bob@ly-usa.com')
    expect(ownerOf({ ...blank, assigned_rep_email: 'gone@ly-usa.com', rep_user_id: 'r1' }, reps)).toBe('ann@ly-usa.com')
  })
})

describe('chooseAutoOwner', () => {
  it('1. uses the rep the order is credited to', () => {
    const o = { ...blank, rep_user_id: 'r2' }
    expect(chooseAutoOwner(o, [prev('2026-10-01', { assigned_rep_email: 'ann@ly-usa.com' })], reps)).toEqual({ email: 'bob@ly-usa.com', why: 'credited rep' })
  })

  it("2. else the owner of the buyer's most recent earlier order that has one", () => {
    const history = [
      prev('2026-08-01', { assigned_rep_email: 'ann@ly-usa.com' }),
      prev('2026-10-01', { placed_by_rep: 'bob@ly-usa.com' }),
      prev('2026-10-20', {}), // most recent, but nobody on it
    ]
    expect(chooseAutoOwner(blank, history, reps)).toEqual({ email: 'bob@ly-usa.com', why: 'previous order' })
  })

  it('3. else leaves it unassigned (no rotation)', () => {
    expect(chooseAutoOwner(blank, [], reps)).toEqual({ email: null, why: 'no rep found' })
    expect(chooseAutoOwner(blank, [prev('2026-10-01', { placed_by_rep: 'Alina' })], reps)).toEqual({ email: null, why: 'no rep found' })
  })

  it('skips an earlier owner who is no longer a rep account', () => {
    const history = [prev('2026-10-01', { assigned_rep_email: 'gone@ly-usa.com' }), prev('2026-09-01', { rep_user_id: 'r1' })]
    expect(chooseAutoOwner(blank, history, reps).email).toBe('ann@ly-usa.com')
  })
})
