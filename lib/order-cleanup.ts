// Context for closing old quote requests (Orders -> Needs follow-up). Pure.
//
// On 2026-11-05 none of the 24 waiting quotes was in QuickBooks or had a
// recorded response, the oldest was 133 days, and 5 had a later quote from
// the same customer. These hints say which, so each can be closed in one
// click: statuses with no customer email (PATCH /admin/api/orders
// { notify: false }), or Duplicate when a later quote replaced it.

import type { OrderStatus } from '@/lib/types'

export interface CleanupOrder {
  id: string
  reference_code: string
  status: OrderStatus
  customer_email: string | null
  subtotal_cents: number
  created_at: string
  dismissed_at: string | null
}

export interface CleanupHint {
  /** Later, non-dismissed requests from the same email, oldest first. */
  later: { id: string; reference_code: string; status: OrderStatus }[]
  /** A request from the same email within 2 days with the same total. */
  possibleDuplicateOf: string | null
}

const email = (o: CleanupOrder) => (o.customer_email ?? '').trim().toLowerCase()
const TWO_DAYS = 2 * 86_400_000

export function cleanupHints(orders: CleanupOrder[]): Map<string, CleanupHint> {
  const byEmail = new Map<string, CleanupOrder[]>()
  for (const o of orders) {
    if (o.dismissed_at || !email(o)) continue
    byEmail.set(email(o), [...(byEmail.get(email(o)) ?? []), o])
  }
  const out = new Map<string, CleanupHint>()
  for (const o of orders) {
    const mine = (byEmail.get(email(o)) ?? []).filter((x) => x.id !== o.id)
    const later = mine
      .filter((x) => x.created_at > o.created_at)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((x) => ({ id: x.id, reference_code: x.reference_code, status: x.status }))
    const dup = mine.find(
      (x) => x.subtotal_cents === o.subtotal_cents && Math.abs(Date.parse(x.created_at) - Date.parse(o.created_at)) < TWO_DAYS,
    )
    out.set(o.id, { later, possibleDuplicateOf: dup?.reference_code ?? null })
  }
  return out
}

/** One line for the table: "Same customer sent ORD-2026-0025 later (converted)". */
export function describeHint(h: CleanupHint | undefined): string | null {
  if (!h) return null
  const parts: string[] = []
  if (h.later.length) parts.push(`Same customer sent ${h.later.map((l) => `${l.reference_code} (${l.status})`).join(', ')} later`)
  if (h.possibleDuplicateOf) parts.push(`same total as ${h.possibleDuplicateOf} within 2 days`)
  return parts.length ? parts.join('; ') : null
}
