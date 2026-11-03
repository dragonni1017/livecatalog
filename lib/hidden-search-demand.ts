// Hidden products customers searched for: zero-result searches whose term is
// exactly a hidden product's SKU or barcode. A ranked, real-demand list for
// deciding which hidden products to show again.

export const NO_RESULTS_PREFIX = '[no_results] '

export interface DemandEvent {
  term: string | null
  created_at: string
}

export interface DemandProduct {
  id: string
  sku: string
  name: string
  barcode: string | null
}

export interface HiddenDemandRow<P extends DemandProduct = DemandProduct> {
  product: P
  times: number
  lastSearched: string
}

/** The search as typed, without the zero-result prefix, lowercased and trimmed. */
export function searchedTerm(term: string | null): string {
  if (!term) return ''
  const t = term.startsWith(NO_RESULTS_PREFIX) ? term.slice(NO_RESULTS_PREFIX.length) : term
  return t.trim().toLowerCase()
}

/** Hidden products whose SKU or barcode was searched, most searched first. */
export function hiddenSearchDemand<P extends DemandProduct>(
  events: DemandEvent[],
  hidden: P[],
): HiddenDemandRow<P>[] {
  const byCode = new Map<string, P>()
  for (const p of hidden) {
    if (p.sku?.trim()) byCode.set(p.sku.trim().toLowerCase(), p)
    if (p.barcode?.trim()) byCode.set(p.barcode.trim().toLowerCase(), p)
  }
  const rows = new Map<string, HiddenDemandRow<P>>()
  for (const e of events) {
    const p = byCode.get(searchedTerm(e.term))
    if (!p) continue
    const row = rows.get(p.id)
    if (!row) rows.set(p.id, { product: p, times: 1, lastSearched: e.created_at })
    else {
      row.times++
      if (e.created_at > row.lastSearched) row.lastSearched = e.created_at
    }
  }
  return [...rows.values()].sort(
    (a, b) => b.times - a.times || b.lastSearched.localeCompare(a.lastSearched) || a.product.sku.localeCompare(b.product.sku),
  )
}
