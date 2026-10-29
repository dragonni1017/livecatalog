// Who owns (follows up) a quote request: order_requests.assigned_rep_email,
// docs/ORDER-FOLLOW-UP-PLAN.md part 2. Pure.
//
// Auto-assignment right after an order is saved, in order of preference:
//   1. the rep the order is credited to (same rule as /admin/reps and
//      /rep/quotes: lib/rep-attribution.ts attributeOrder);
//   2. the owner of this buyer's most recent earlier order (its assigned rep
//      if that is still a rep account, else the rep it is credited to);
//   3. nobody. Decided 2026-10-29: leave it unassigned (the sales inbox covers
//      it), no rotation through the reps.

import { attributeOrder, type RepAccount } from '@/lib/rep-attribution'

export interface OwnableOrder {
  placed_by_rep: string | null
  rep_user_id: string | null
  assigned_rep_email: string | null
}

export interface PreviousOrder extends OwnableOrder {
  created_at: string
}

/** The rep account with this email (case-insensitive), or undefined. */
export function findRep(email: string | null | undefined, reps: RepAccount[]): RepAccount | undefined {
  const e = email?.trim().toLowerCase()
  if (!e) return undefined
  return reps.find((r) => r.email.toLowerCase() === e)
}

/** The rep email an order is credited to, or null. */
export function creditedRepEmail(order: Pick<OwnableOrder, 'placed_by_rep' | 'rep_user_id'>, reps: RepAccount[]): string | null {
  const a = attributeOrder(order, reps)
  if (a.kind !== 'rep') return null
  return reps.find((r) => r.id === a.repId)?.email ?? null
}

/** An order's current owner if it is still a rep account, else the rep it is credited to. */
export function ownerOf(order: OwnableOrder, reps: RepAccount[]): string | null {
  return findRep(order.assigned_rep_email, reps)?.email ?? creditedRepEmail(order, reps)
}

export type AutoOwner =
  | { email: string; why: 'credited rep' | 'previous order' }
  | { email: null; why: 'no rep found' }

export function chooseAutoOwner(order: OwnableOrder, previous: PreviousOrder[], reps: RepAccount[]): AutoOwner {
  const credited = creditedRepEmail(order, reps)
  if (credited) return { email: credited, why: 'credited rep' }
  const latestFirst = [...previous].sort((a, b) => b.created_at.localeCompare(a.created_at))
  for (const p of latestFirst) {
    const owner = ownerOf(p, reps)
    if (owner) return { email: owner, why: 'previous order' }
  }
  return { email: null, why: 'no rep found' }
}
