// "Show these?" (/admin/show-review): hidden products that are otherwise
// complete (photo, price, category, real description; lib/woo-export.ts), one
// card each, for the owner to Show or Keep hidden. Pure.
//
// A Keep hidden decision is an audit row (no table needed); the latest of
// keep/reopen per product wins. Sold-out hides are left off (soldOutHidden).

export const SHOW_REVIEW_KEEP = 'show_review_kept_hidden'
export const SHOW_REVIEW_REOPEN = 'show_review_reopened'

export interface DecisionRow {
  entity_id: string | null
  action: string
  created_at: string
}

/** Product ids whose latest show-review decision is "keep hidden". */
export function keptHidden(rows: DecisionRow[]): Set<string> {
  const latest = new Map<string, DecisionRow>()
  for (const r of rows) {
    if (!r.entity_id || (r.action !== SHOW_REVIEW_KEEP && r.action !== SHOW_REVIEW_REOPEN)) continue
    const cur = latest.get(r.entity_id)
    if (!cur || r.created_at > cur.created_at) latest.set(r.entity_id, r)
  }
  return new Set([...latest].filter(([, r]) => r.action === SHOW_REVIEW_KEEP).map(([id]) => id))
}

// A product hidden because it's sold out isn't a "should we show it?"
// question. Scripts that hide sold-out products log `product_hidden` with
// "sold-out" or "sold out" in performed_by (first used 2026-11-10, 77 rows).
// A later visibility change from the admin (product_visibility_changed)
// supersedes the hide.
export const HIDE_ACTION = 'product_hidden'
export const VISIBILITY_ACTION = 'product_visibility_changed'
const SOLD_OUT = /sold[- ]out/i

export interface HideRow extends DecisionRow {
  performed_by: string | null
}

/** Product ids whose latest hide/visibility event is a sold-out hide. */
export function soldOutHidden(rows: HideRow[]): Set<string> {
  const latest = new Map<string, HideRow>()
  for (const r of rows) {
    if (!r.entity_id || (r.action !== HIDE_ACTION && r.action !== VISIBILITY_ACTION)) continue
    const cur = latest.get(r.entity_id)
    if (!cur || r.created_at > cur.created_at) latest.set(r.entity_id, r)
  }
  return new Set(
    [...latest].filter(([, r]) => r.action === HIDE_ACTION && SOLD_OUT.test(r.performed_by ?? '')).map(([id]) => id),
  )
}

export interface ShowCandidate {
  id: string
  sku: string
  searches: number
  stock: number
}

/** Most searched first, then most stock, then SKU. */
export function orderCandidates<T extends ShowCandidate>(rows: T[]): T[] {
  return [...rows].sort((a, b) => b.searches - a.searches || b.stock - a.stock || a.sku.localeCompare(b.sku))
}
