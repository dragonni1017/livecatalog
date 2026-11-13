// Catalog health (/admin/catalog-health): the checks that were being run by
// hand: visible products without a price or photo, last night's sync,
// low-stock email setup, held prices, stale review items, searches that found
// nothing. Pure: the page loads the data (lib/catalog-health-load.ts) and these
// decide what is OK, what to look at and what is a problem.

import { searchedTerm, type DemandEvent } from '@/lib/hidden-search-demand'

export type Level = 'ok' | 'look' | 'problem'

export interface Check {
  key: string
  title: string
  level: Level
  summary: string
  // Up to a handful of affected items, for the page to list.
  items?: { label: string; detail?: string; href?: string }[]
  link?: { href: string; label: string }
}

export const LEVEL_ORDER: Record<Level, number> = { problem: 0, look: 1, ok: 2 }

export interface VisibleProduct {
  id: string
  sku: string
  name: string
  price_cents: number | null
  image_url: string | null
  needs_photo: boolean | null
}

const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`

export function visibleProductsCheck(products: VisibleProduct[]): Check {
  const noPrice = products.filter((p) => !(p.price_cents && p.price_cents > 0))
  const noPhoto = products.filter((p) => !p.image_url?.trim())
  const needsPhoto = products.filter((p) => p.needs_photo && p.image_url?.trim())
  const bad = [...noPrice, ...noPhoto]
  const level: Level = bad.length ? 'problem' : needsPhoto.length ? 'look' : 'ok'
  const parts = [
    `${plural(products.length, 'product')} visible`,
    noPrice.length ? `${noPrice.length} without a price` : 'all priced',
    noPhoto.length ? `${noPhoto.length} without a photo` : 'all with a photo',
  ]
  if (needsPhoto.length) parts.push(`${needsPhoto.length} flagged "needs photo"`)
  const item = (p: VisibleProduct, detail: string) => ({ label: `${p.sku} ${p.name}`, detail, href: `/product/${p.id}` })
  return {
    key: 'visible',
    title: 'Visible products',
    level,
    summary: parts.join(', ') + '.',
    items: [
      ...noPrice.map((p) => item(p, 'no price')),
      ...noPhoto.map((p) => item(p, 'no photo')),
      ...needsPhoto.map((p) => item(p, 'flagged needs photo')),
    ],
  }
}

export interface SyncRun {
  started_at: string
  status: string | null
  updated: number | null
  error_count: number | null
  details: Record<string, unknown> | null
}

/** Last product sync: did it run in the last day, cleanly. */
export function syncCheck(run: SyncRun | null, nowMs: number): Check {
  if (!run) return { key: 'sync', title: 'Nightly sync', level: 'problem', summary: 'No sync run recorded.', link: { href: '/admin/sync', label: 'Sync page' } }
  const hours = (nowMs - Date.parse(run.started_at)) / 3_600_000
  const late = hours > 26
  const failed = run.status !== 'ok' || (run.error_count ?? 0) > 0
  const level: Level = failed || late ? 'problem' : 'ok'
  const when = hours < 1 ? 'under an hour ago' : `${Math.round(hours)} hours ago`
  const summary =
    `Last ran ${when}` +
    (run.status === 'ok' ? `, ${(run.updated ?? 0).toLocaleString()} products refreshed` : `, status "${run.status ?? 'unknown'}"`) +
    ((run.error_count ?? 0) > 0 ? `, ${run.error_count} errors` : ', no errors') +
    (late ? '. It should run every morning (08:00 UTC).' : '.')
  return { key: 'sync', title: 'Nightly sync', level, summary, link: { href: '/admin/sync', label: 'Sync page' } }
}

export interface LowStockState {
  switchOn: boolean
  recipientSet: boolean
  // details.lowStock from the last sync run, if any.
  lastResult: unknown
}

/** The low-stock email: the admin switch and the REORDER_ALERT_TO recipient. */
export function lowStockEmailCheck(s: LowStockState): Check {
  const base = { key: 'low-stock-email', title: 'Low-stock email', link: { href: '/admin/products', label: 'Switch on Products & Stock' } }
  if (!s.recipientSet && s.switchOn) {
    return { ...base, level: 'problem', summary: 'Switched on, but no recipient is set (REORDER_ALERT_TO in Vercel), so nothing is sent.' }
  }
  if (!s.recipientSet) {
    return {
      ...base,
      level: 'look',
      summary:
        'Off, and no recipient is set (REORDER_ALERT_TO in Vercel). Turning the switch on would still send nothing; add the recipient back first.',
    }
  }
  return { ...base, level: 'ok', summary: s.switchOn ? 'On, and a recipient is set.' : 'Off (switched off in admin). A recipient is set, so switching it on works.' }
}

/** Storefront price display (Display Settings). */
export function priceDisplayCheck(listing: boolean, detail: boolean): Check {
  const base = { key: 'price-display', title: 'Prices on the storefront', link: { href: '/admin/display-settings', label: 'Display Settings' } }
  if (listing && detail) return { ...base, level: 'ok', summary: 'Shown on listings and product pages.' }
  const where = !listing && !detail ? 'listings and product pages' : !listing ? 'listings' : 'product pages'
  return { ...base, level: 'look', summary: `Hidden on ${where}. Carts and quotes still use the prices. Fine if on purpose.` }
}

/** Held prices: set in the catalog, not yet typed into Erply. */
export function heldPricesCheck(heldCount: number): Check {
  return {
    key: 'held',
    title: 'Prices waiting for Erply',
    level: heldCount > 0 ? 'look' : 'ok',
    summary: heldCount
      ? `${plural(heldCount, 'catalog price')} not in Erply yet. The catalog keeps them; each clears itself after the nightly sync once Erply matches.`
      : 'None. Every catalog price matches Erply.',
    link: heldCount ? { href: '/admin/api/price-review/erply', label: 'Download the list for Erply' } : undefined,
  }
}

export interface PendingReviewItem {
  sku: string
  suggested_cents: number | null
  live_cents: number | null
}

/** Price Review items still pending although the live price already equals the suggestion. */
export function staleReviewCheck(pending: PendingReviewItem[]): Check {
  const stale = pending.filter((i) => i.suggested_cents != null && i.suggested_cents === i.live_cents)
  const open = pending.length - stale.length
  return {
    key: 'review',
    title: 'Price Review queue',
    level: stale.length ? 'look' : 'ok',
    summary:
      `${plural(pending.length, 'item')} pending` +
      (stale.length ? `; ${stale.length} of them already match the live price and only need marking done` : '') +
      (open ? `; ${open} need a decision.` : '.'),
    items: stale.map((i) => ({ label: i.sku, detail: `already ${((i.live_cents ?? 0) / 100).toFixed(2)}` })),
    link: { href: '/admin/price-review', label: 'Price Review' },
  }
}

/**
 * Drop searches that are only the start of a longer search in the same list:
 * the log records "plush sup", "plush supe", "plush supei" as someone types.
 */
export function dropTypingPrefixes(terms: string[]): string[] {
  const set = [...new Set(terms)]
  return set.filter((t) => !set.some((o) => o !== t && o.startsWith(t)))
}

/** A search that looks like a product code or barcode rather than words. */
export function looksLikeCode(term: string): boolean {
  const t = term.trim()
  // SKUs are a short prefix (letters or "3D") then digits, maybe "-45CM"; or a barcode.
  return (/^[a-z0-9]{1,4}\d{4,}(?:-[a-z0-9]+)?$/i.test(t) && /\d{5,}/.test(t)) || /^\d{8,14}$/.test(t)
}

export interface CodeLookup {
  // lowercased SKU or barcode -> where it is
  get(code: string): 'visible' | 'hidden' | 'inactive' | undefined
}

export interface SearchSummary {
  total: number
  zero: number
  topTerms: { term: string; times: number }[]
  missingCodes: { term: string; times: number }[]
  hiddenCodes: { term: string; times: number }[]
}

/** Zero-result searches in a window: the words people tried, and codes that aren't findable. */
export function summarizeSearches(events: DemandEvent[], totalSearches: number, codes: CodeLookup): SearchSummary {
  const counts = new Map<string, number>()
  for (const e of events) {
    const t = searchedTerm(e.term)
    if (t) counts.set(t, (counts.get(t) ?? 0) + 1)
  }
  const kept = new Set(dropTypingPrefixes([...counts.keys()]))
  const rows = [...counts].filter(([t]) => kept.has(t)).map(([term, times]) => ({ term, times }))
  rows.sort((a, b) => b.times - a.times || a.term.localeCompare(b.term))
  const isCode = rows.filter((r) => looksLikeCode(r.term))
  return {
    total: totalSearches,
    zero: events.length,
    topTerms: rows.filter((r) => !looksLikeCode(r.term)).slice(0, 15),
    missingCodes: isCode.filter((r) => !codes.get(r.term)).slice(0, 15),
    hiddenCodes: isCode.filter((r) => { const w = codes.get(r.term); return w === 'hidden' || w === 'inactive' }).slice(0, 15),
  }
}

export function searchCheck(s: SearchSummary, days: number): Check {
  const share = s.total + s.zero > 0 ? Math.round((s.zero / (s.total + s.zero)) * 100) : 0
  const level: Level = s.missingCodes.length || s.hiddenCodes.length ? 'look' : 'ok'
  return {
    key: 'search',
    title: `Searches, last ${days} days`,
    level,
    summary:
      `${plural(s.zero, 'search', 'searches')} found nothing (${share}% of searches, counting partial words logged while typing)` +
      (s.missingCodes.length ? `; ${plural(s.missingCodes.length, 'product code')} searched that ${s.missingCodes.length === 1 ? "isn't" : "aren't"} in the catalog at all` : '') +
      (s.hiddenCodes.length ? `; ${plural(s.hiddenCodes.length, 'hidden product')} searched by code` : '') +
      '.',
    link: { href: '/admin/zero-results', label: 'Zero Results' },
  }
}

export interface PhotoResponse {
  ok: boolean
  status: number | string
  contentType: string
  bytes: number // content-length; 0 when the server doesn't say
}

// Under this, a "photo" has turned out to be a ~60px thumbnail (2026-11-12:
// 8 visible products, real images but blurry at product-page size).
export const TINY_PHOTO_BYTES = 1500

export type PhotoVerdict = 'ok' | 'broken' | 'tiny'

export function classifyPhoto(r: PhotoResponse): PhotoVerdict {
  if (!r.ok || !r.contentType.startsWith('image/')) return 'broken'
  if (r.bytes > 0 && r.bytes < TINY_PHOTO_BYTES) return 'tiny'
  return 'ok'
}
