// What a PATCH /admin/api/products edit changed, for the audit log. Pure.
//
// Until 2026-11-06 that route logged nothing but deletes, so Show/Hidden
// clicks (Zero-result searches, the photo upload's Show buttons) and inline
// name, description and price edits left no trace. Visibility gets its own
// entry so it's easy to find; every other changed field goes in one entry.

/** Bookkeeping columns the route sets itself; never worth an audit line. */
const NOT_AUDITED = new Set(['updated_at', 'awaiting_price', 'measurements_source', 'measurements_updated_at', 'measurements_updated_by'])

export interface ProductChange {
  /** "hidden" / "shown", only when manually_hidden actually changed. */
  visibility: { old: string; new: string } | null
  /** Other fields that changed, old and new as JSON-able values. */
  fields: Record<string, { old: unknown; new: unknown }>
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const shown = (hidden: unknown) => (hidden ? 'hidden' : 'shown')

export function productChange(before: Record<string, unknown>, updates: Record<string, unknown>): ProductChange {
  let visibility: ProductChange['visibility'] = null
  const fields: ProductChange['fields'] = {}
  for (const [k, v] of Object.entries(updates)) {
    if (NOT_AUDITED.has(k) || same(before[k], v)) continue
    if (k === 'manually_hidden') visibility = { old: shown(before[k]), new: shown(v) }
    else fields[k] = { old: before[k] ?? null, new: v ?? null }
  }
  return { visibility, fields }
}

/** Compact JSON for an audit value, capped so a long description can't bloat the log. */
export function auditJson(o: Record<string, unknown>, max = 4000): string {
  const s = JSON.stringify(o)
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`
}
