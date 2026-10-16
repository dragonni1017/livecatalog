// Client-side analytics helper for /api/track. Fire-and-forget: tracking must
// never block or break the page, so every failure is swallowed.
//
// Every event carries an anonymous visitor id (a random UUID kept in
// localStorage, no personal data) so /admin/analytics can count one visitor
// across the funnel steps. Private windows or blocked storage get a fresh id
// per page load, which only makes the funnel undercount.

const VISITOR_KEY = 'lyu_vid'

export type TrackEvent =
  | { type: 'view'; productId: string }
  | { type: 'search'; term: string }
  | { type: 'search_no_results'; query: string }
  | { type: 'add_to_cart' }
  | { type: 'cart_view' }
  | { type: 'quote_submitted' }

let memoryVisitorId: string | null = null

function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  }
}

export function getVisitorId(): string {
  try {
    const existing = window.localStorage.getItem(VISITOR_KEY)
    if (existing) return existing
    const id = newId()
    window.localStorage.setItem(VISITOR_KEY, id)
    return id
  } catch {
    memoryVisitorId ??= newId()
    return memoryVisitorId
  }
}

export function track(event: TrackEvent): void {
  if (typeof window === 'undefined') return
  try {
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...event, visitorId: getVisitorId() }),
      keepalive: true,
    }).catch(() => {})
  } catch {
    // never let tracking throw into the caller
  }
}
