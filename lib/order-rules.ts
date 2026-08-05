/**
 * Shared order-submission rules, used by both the cart (client) and the
 * /api/orders endpoint (server) so the UI and the server agree.
 */

// Minimum order subtotal in cents required to submit. 0 disables the minimum.
// Change this one number to set/raise/lower the wholesale order minimum
// (e.g. 10000 = $100.00).
export const MIN_ORDER_SUBTOTAL_CENTS = 0

export function meetsOrderMinimum(subtotalCents: number): boolean {
  return subtotalCents >= MIN_ORDER_SUBTOTAL_CENTS
}

export function formatPriceCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export interface VolumeTier {
  min_qty: number
  price_cents: number
}

// Returns the effective unit price for a given qty, applying the highest
// matching volume tier. Falls back to baseCents when no tiers apply.
export function getEffectivePrice(
  baseCents: number,
  qty: number,
  tiers?: VolumeTier[] | null,
): number {
  if (!tiers?.length) return baseCents
  const match = [...tiers]
    .sort((a, b) => b.min_qty - a.min_qty)
    .find((t) => qty >= t.min_qty)
  return match ? match.price_cents : baseCents
}
