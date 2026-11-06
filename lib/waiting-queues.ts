import { queueAge, lastSeen, type QueueAge } from './queue-age.ts'

// "Waiting on you" (/admin/waiting): every queue that needs a person, on one
// screen, with how long it has waited and who it's for. Pure: the page loads
// the raw rows, this decides the wording and order.

export type Who = 'Sales' | 'Office' | 'Owner' | 'Price setter' | 'Warehouse' | 'Photos'

export interface WaitingQueue {
  key: string
  title: string
  who: Who
  count: number
  /** "3 quotes", "120 renames" */
  countText: string
  age: QueueAge | null
  /** Extra line, e.g. "last searched today". */
  note: string | null
  href: string
}

export interface WaitingInput {
  nowIso: string
  /** created_at of each item, per queue; null when that queue failed to load (left out). */
  quotesToAnswer: string[] | null
  ordersForQuickBooks: string[] | null
  creditApplications: string[] | null
  resaleCertificates: string[] | null
  stagedShipments: string[] | null
  caseCounts: string[] | null
  names: string[] | null
  prices: string[] | null
  /** owner_questions still open (migration 0073); optional so older callers needn't pass it. */
  ownerQuestions?: string[] | null
  /** Held prices have no timestamp; count only. */
  pricesForErply: number | null
  /** lastSearched of each hidden product searched by SKU. */
  hiddenSearched: string[] | null
  photosToTake: number | null
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function buildWaitingQueues(i: WaitingInput): WaitingQueue[] {
  const out: WaitingQueue[] = []
  const add = (q: Omit<WaitingQueue, 'age' | 'note'> & { age?: QueueAge | null; note?: string | null }) => {
    if (q.count > 0) out.push({ age: null, note: null, ...q })
  }
  const timed = (key: string, title: string, who: Who, rows: string[] | null, unit: [string, string?], href: string) => {
    if (!rows) return
    add({ key, title, who, count: rows.length, countText: plural(rows.length, unit[0], unit[1]), age: queueAge(rows, i.nowIso), href })
  }

  timed('quotes', 'Quote requests to answer', 'Sales', i.quotesToAnswer, ['quote'], '/admin/orders?view=followup')
  timed('quickbooks', 'Orders to enter in QuickBooks', 'Office', i.ordersForQuickBooks, ['order'], '/admin/orders')
  timed('credit', 'Credit applications to decide', 'Owner', i.creditApplications, ['application'], '/admin/credit-applications')
  timed('certificates', 'Resale certificates to check', 'Office', i.resaleCertificates, ['certificate'], '/admin/resale-certificates')
  timed('shipments', 'Shipments staged, not yet applied', 'Warehouse', i.stagedShipments, ['shipment'], '/admin/receiving')
  timed('case-counts', 'Case counts to decide', 'Warehouse', i.caseCounts, ['product'], '/admin/case-count-review')
  timed('names', 'Product renames to decide', 'Owner', i.names, ['rename'], '/admin/name-review')
  timed('prices', 'Prices to decide', 'Price setter', i.prices, ['price'], '/admin/price-review')
  timed('owner-questions', 'Owner questions to answer', 'Owner', i.ownerQuestions ?? null, ['question'], '/admin/owner-questions')
  if (i.pricesForErply != null) {
    add({
      key: 'erply',
      title: 'Prices to type into Erply',
      who: 'Price setter',
      count: i.pricesForErply,
      countText: plural(i.pricesForErply, 'price'),
      note: 'set on the website, not yet in Erply; each clears itself once Erply matches',
      href: '/admin/price-review',
    })
  }
  if (i.hiddenSearched) {
    const seen = lastSeen(i.hiddenSearched, i.nowIso)
    add({
      key: 'hidden',
      title: 'Hidden products customers searched for',
      who: 'Owner',
      count: i.hiddenSearched.length,
      countText: plural(i.hiddenSearched.length, 'product'),
      note: seen ? `last searched ${seen}` : null,
      href: '/admin/zero-results#hidden',
    })
  }
  if (i.photosToTake != null) {
    add({
      key: 'photos',
      title: 'In-stock products to photograph',
      who: 'Photos',
      count: i.photosToTake,
      countText: plural(i.photosToTake, 'product'),
      href: '/admin/photo-shot-list',
    })
  }

  // Stale first, then the longest waiting, then the biggest.
  return out.sort(
    (a, b) =>
      Number(b.age?.stale ?? false) - Number(a.age?.stale ?? false) ||
      (b.age?.days ?? 0) - (a.age?.days ?? 0) ||
      b.count - a.count,
  )
}

export const WHO_ORDER: Who[] = ['Owner', 'Sales', 'Office', 'Price setter', 'Warehouse', 'Photos']
