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
