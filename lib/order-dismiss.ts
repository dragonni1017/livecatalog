// Silent dismissal of a quote request (migration 0069,
// docs/ORDER-FOLLOW-UP-PLAN.md part 1).
//
// Dismissing is NOT a status. Marking an order 'lost' emails the customer;
// dismissing only takes a test, duplicate or spam request out of the
// "waiting" counts. It sends no email, changes no stock and never reaches
// QuickBooks, so it is allowed only while the order is still 'new' and not
// keyed into QuickBooks. Undo clears the three dismissed_* columns.

import type { OrderStatus } from '@/lib/types'

export const DISMISS_REASONS = ['test', 'duplicate', 'spam'] as const
export type DismissReason = (typeof DISMISS_REASONS)[number]

export const DISMISS_REASON_LABELS: Record<DismissReason, string> = {
  test: 'Test order',
  duplicate: 'Duplicate',
  spam: 'Spam',
}

export function isDismissReason(v: unknown): v is DismissReason {
  return typeof v === 'string' && (DISMISS_REASONS as readonly string[]).includes(v)
}

export type DismissRequest =
  | { kind: 'dismiss'; id: string; reason: DismissReason }
  | { kind: 'undo'; id: string }

/** Reads `{ id, reason }` (dismiss) or `{ id, undo: true }` (undo). */
export function parseDismissBody(body: unknown): DismissRequest | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Invalid request' }
  const b = body as Record<string, unknown>
  const id = typeof b.id === 'string' ? b.id.trim() : ''
  if (!id) return { error: 'Missing order id' }
  if (b.undo === true) {
    if (b.reason !== undefined) return { error: 'Send either a reason or undo, not both' }
    return { kind: 'undo', id }
  }
  if (!isDismissReason(b.reason)) return { error: 'Reason must be test, duplicate or spam' }
  return { kind: 'dismiss', id, reason: b.reason }
}

export interface DismissableOrder {
  status: OrderStatus
  entered_in_qb: boolean
  dismissed_at: string | null
}

/** Why this order can't be dismissed right now, or null if it can. */
export function dismissBlocker(order: DismissableOrder): string | null {
  if (order.dismissed_at) return 'This order is already dismissed.'
  if (order.status !== 'new') return 'Only a new order can be dismissed. Use the status buttons for this one.'
  if (order.entered_in_qb) return 'This order is marked as entered in QuickBooks, so it is not a test.'
  return null
}
