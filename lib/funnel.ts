// Visitor funnel math for /admin/analytics, from analytics_events rows that
// carry a visitor_id (migration 0056) and an optional source (0062). Pure.

export interface FunnelEvent {
  visitor_id: string
  type: string
  source?: string | null
}

export interface FunnelStep {
  label: string
  visitors: number
}

export interface QrSummary {
  /** Product views opened from a printed line-card QR code. */
  scans: number
  /** Distinct visitors who scanned at least one code in the period. */
  visitors: number
  /** Of those visitors, how many also did each step (any time in the period). */
  addedToCart: number
  openedCart: number
  submittedQuote: number
}

export interface BlockedReason {
  /** analytics_events.source of a quote_submit_blocked event (lib/quote-form-events.ts). */
  reason: string
  /** Distinct visitors who hit it at least once. */
  visitors: number
}

export function summarizeFunnel(rows: FunnelEvent[]): { steps: FunnelStep[]; qr: QrSummary; blocked: BlockedReason[] } {
  const all = new Set<string>()
  const byType = new Map<string, Set<string>>()
  const qrVisitors = new Set<string>()
  let scans = 0
  for (const r of rows) {
    all.add(r.visitor_id)
    let s = byType.get(r.type)
    if (!s) byType.set(r.type, (s = new Set()))
    s.add(r.visitor_id)
    if (r.source === 'qr' && r.type === 'view') {
      scans++
      qrVisitors.add(r.visitor_id)
    }
  }
  const count = (t: string) => byType.get(t)?.size ?? 0
  const qrDid = (t: string) => [...qrVisitors].filter((v) => byType.get(t)?.has(v)).length
  const blockedBy = new Map<string, Set<string>>()
  for (const r of rows) {
    if (r.type !== 'quote_submit_blocked') continue
    const k = r.source ?? 'missing_other'
    let s = blockedBy.get(k)
    if (!s) blockedBy.set(k, (s = new Set()))
    s.add(r.visitor_id)
  }
  // The form step is only tracked since migration 0075; before that it would
  // read 0 and look like everyone quit there, so it's left out until it exists.
  const formStep = byType.has('quote_form_started') ? [{ label: 'Started the quote form', visitors: count('quote_form_started') }] : []

  return {
    // Step 1 is every tracked visitor, not only those who viewed or searched,
    // so someone who went straight to Quick Order still counts as a visitor.
    // Later steps are each counted on their own, not as a strict subset of
    // the step before (a reorder skips "added to cart" via the product page).
    steps: [
      { label: 'Visited (viewed, searched or used the cart)', visitors: all.size },
      { label: 'Added to cart', visitors: count('add_to_cart') },
      { label: 'Opened cart', visitors: count('cart_view') },
      ...formStep,
      { label: 'Submitted a quote', visitors: count('quote_submitted') },
    ],
    blocked: [...blockedBy]
      .map(([reason, v]) => ({ reason, visitors: v.size }))
      .sort((a, b) => b.visitors - a.visitors || a.reason.localeCompare(b.reason)),
    qr: {
      scans,
      visitors: qrVisitors.size,
      addedToCart: qrDid('add_to_cart'),
      openedCart: qrDid('cart_view'),
      submittedQuote: qrDid('quote_submitted'),
    },
  }
}
