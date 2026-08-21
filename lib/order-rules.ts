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

// Rounds a price in cents to the nearest quarter-dollar stop (.00/.25/.50/
// next whole dollar), skipping .75 -- the storefront-wide pricing policy
// decided 2026-08-06 (see lib/erply.ts's roundToQuarterSkip75, which
// applies the same rule in dollars to the base synced price). Cents-based
// here so tier/discount math -- already working in cents -- can round its
// own result without a dollars round-trip.
export function roundCentsToQuarterSkip75(cents: number): number {
  const dollars = Math.floor(cents / 100)
  const remainder = Math.round(cents - dollars * 100) // 0-99
  const stops = [0, 25, 50, 100]
  let nearest = stops[0]
  let minDiff = Infinity
  for (const stop of stops) {
    const diff = Math.abs(remainder - stop)
    if (diff < minDiff) {
      minDiff = diff
      nearest = stop
    }
  }
  return nearest === 100 ? (dollars + 1) * 100 : dollars * 100 + nearest
}

// Rounds a price in cents to the nearest quarter-dollar stop, including
// .75 -- unlike roundCentsToQuarterSkip75 above (the base list-price sync
// policy, which deliberately skips .75), discount/markup math needs .75
// available as a landing stop. Skipping it here meant a modest discount on
// an already-clean price could round straight back to the original: 8% off
// a $3.00 item is 276 cents, whose nearest *skip-75* stop is the next whole
// dollar -- $3.00 again, making an active discount invisible. Confirmed
// live 2026-08-21 (Distribution Chain, 8% off, on $3.00 SKUs).
export function roundCentsToQuarter(cents: number): number {
  const dollars = Math.floor(cents / 100)
  const remainder = Math.round(cents - dollars * 100) // 0-99
  const stops = [0, 25, 50, 75, 100]
  let nearest = stops[0]
  let minDiff = Infinity
  for (const stop of stops) {
    const diff = Math.abs(remainder - stop)
    if (diff < minDiff) {
      minDiff = diff
      nearest = stop
    }
  }
  return nearest === 100 ? (dollars + 1) * 100 : dollars * 100 + nearest
}

// Applies a flat percentage discount to a price in cents, then rounds to
// the nearest quarter (see roundCentsToQuarter) so discounted/marked-up
// prices land on clean stops instead of arbitrary cent amounts. Used for
// both the per-customer discount_percent on file (app/api/orders/route.ts)
// and rep-selected price_tiers.discount_percent -- same function on the
// client (for preview) and the server (at submit time) so the two can
// never disagree.
export function applyTierDiscount(cents: number, discountPercent: number): number {
  if (!discountPercent) return cents
  const adjusted = Math.round(cents * (1 - discountPercent / 100))
  return roundCentsToQuarter(adjusted)
}

// price_tiers.code ('distribution_chain') -> display label ('Distribution Chain').
export function tierLabel(code: string): string {
  return code
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

// price_tiers.discount_percent can be negative -- historically meaningful
// when the stored base price was Wholesale and Retail priced above it was a
// markup (encoded as a negative "discount"). As of the 2026-08-21 pricing
// flip (see lib/erply.ts's RETAIL_MULTIPLIER) the stored base price is
// Retail itself, so every active tier is now a positive discount and this
// sign-handling is dormant rather than removed -- kept in case a future
// tier is ever priced above Retail again. applyTierDiscount() already
// handles the sign correctly for the actual price math either way; this
// just describes it in human terms for display.
export function formatTierAdjustment(discountPercent: number): string {
  if (discountPercent > 0) return `${discountPercent}% off`
  if (discountPercent < 0) return `${Math.abs(discountPercent)}% markup`
  return '—'
}
