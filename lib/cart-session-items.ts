// Shared by /api/cart-session (save) and lib/abandoned-cart.ts (send).
//
// /api/cart-session is public and unauthenticated by design: guests type an
// email at checkout, and that's what an abandoned-cart reminder goes to. So
// nothing a caller sends may reach the email as text. Until 2026-10-01 the
// route stored client-supplied item names and prices and a free-text name,
// and the reminder emailed them from company SMTP to any address. That made
// it a spam/phishing relay. Product text now always comes from the products
// table, and the greeting name is reduced to plain name characters.

export const MAX_CART_ITEMS = 200
export const MAX_ITEM_QTY = 100_000
const MAX_SKU_LENGTH = 64
const MAX_GREETING_NAME = 60

export interface RequestedItem {
  sku: string
  qty: number
}

/**
 * Keep only well-formed `{sku, qty}` pairs. Every other field the caller sent
 * is dropped. Duplicate SKUs are merged, and the result is capped.
 */
export function parseRequestedItems(raw: unknown): RequestedItem[] {
  if (!Array.isArray(raw)) return []
  const bySku = new Map<string, number>()
  for (const i of raw) {
    if (typeof i !== 'object' || i === null) continue
    const sku = (i as { sku?: unknown }).sku
    const qty = (i as { qty?: unknown }).qty
    if (typeof sku !== 'string') continue
    const s = sku.trim()
    if (!s || s.length > MAX_SKU_LENGTH) continue
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > MAX_ITEM_QTY) continue
    bySku.set(s, Math.min(MAX_ITEM_QTY, (bySku.get(s) ?? 0) + qty))
    if (bySku.size >= MAX_CART_ITEMS) break
  }
  return [...bySku].map(([sku, qty]) => ({ sku, qty }))
}

/**
 * A greeting name that can't carry a link or a message: letters (any
 * script), spaces, apostrophes and hyphens only, collapsed and capped.
 * Dots, slashes, digits and @ are removed, so "evil.com" can't survive.
 * Returns null when nothing usable is left.
 */
export function sanitizeGreetingName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const cleaned = raw
    .replace(/[^\p{L}\p{M} '\-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_GREETING_NAME)
    .trim()
  return cleaned || null
}
