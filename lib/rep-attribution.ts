// Which rep an order belongs to, and per-rep totals, for /admin/reps and the
// rep's own /rep/quotes. Pure.
//
// An order records a rep two ways:
//   placed_by_rep — the checkout "Placed by (rep)" dropdown or a ?rep= link.
//                   A rep account EMAIL since the dropdown; free-text names
//                   ("Alina", "Cong") on older orders.
//   rep_user_id   — set when a signed-in rep placed/priced it (0028-0030).
// Rule: credit the rep account whose email matches placed_by_rep; else the
// rep_user_id account; else list it under the unlinked name. (On 2026-10-16
// every order with both fields had them agree.)

export interface RepAccount {
  id: string
  email: string
}

export interface AttributableOrder {
  id: string
  reference_code: string
  created_at: string
  status: string
  subtotal_cents: number
  placed_by_rep: string | null
  rep_user_id: string | null
}

export type Attribution = { kind: 'rep'; repId: string } | { kind: 'unlinked'; name: string } | { kind: 'none' }

export function attributeOrder(order: Pick<AttributableOrder, 'placed_by_rep' | 'rep_user_id'>, reps: RepAccount[]): Attribution {
  const placed = order.placed_by_rep?.trim() ?? ''
  if (placed) {
    const match = reps.find((r) => r.email.toLowerCase() === placed.toLowerCase())
    if (match) return { kind: 'rep', repId: match.id }
  }
  if (order.rep_user_id && reps.some((r) => r.id === order.rep_user_id)) return { kind: 'rep', repId: order.rep_user_id }
  if (placed) return { kind: 'unlinked', name: placed }
  return { kind: 'none' }
}

export const OPEN_STATUSES = new Set(['new', 'contacted'])

export interface RepSummary {
  orders: number
  quoteValueCents: number
  converted: number
  convertedValueCents: number
  open: number
  openValueCents: number
  lost: number
  lastOrderAt: string | null
}

export function summarize(orders: Pick<AttributableOrder, 'status' | 'subtotal_cents' | 'created_at'>[]): RepSummary {
  const s: RepSummary = { orders: 0, quoteValueCents: 0, converted: 0, convertedValueCents: 0, open: 0, openValueCents: 0, lost: 0, lastOrderAt: null }
  for (const o of orders) {
    const cents = o.subtotal_cents ?? 0
    s.orders++
    s.quoteValueCents += cents
    if (o.status === 'converted') {
      s.converted++
      s.convertedValueCents += cents
    } else if (OPEN_STATUSES.has(o.status)) {
      s.open++
      s.openValueCents += cents
    } else if (o.status === 'lost') {
      s.lost++
    }
    if (!s.lastOrderAt || o.created_at > s.lastOrderAt) s.lastOrderAt = o.created_at
  }
  return s
}

/** Groups orders by credited rep, plus unlinked legacy names. */
export function groupByRep<T extends AttributableOrder>(orders: T[], reps: RepAccount[]) {
  const byRep = new Map<string, T[]>()
  const unlinked = new Map<string, T[]>()
  for (const r of reps) byRep.set(r.id, [])
  for (const o of orders) {
    const a = attributeOrder(o, reps)
    if (a.kind === 'rep') byRep.get(a.repId)!.push(o)
    else if (a.kind === 'unlinked') unlinked.set(a.name, [...(unlinked.get(a.name) ?? []), o])
  }
  return { byRep, unlinked }
}

/** Days → ISO lower bound, or null for all time. Accepts '30' | '90' | '365' | 'all'. */
export function periodSince(days: string | undefined, now: number = Date.now()): { key: string; since: string | null } {
  const key = days === '30' || days === '90' || days === '365' ? days : 'all'
  return { key, since: key === 'all' ? null : new Date(now - Number(key) * 864e5).toISOString() }
}
