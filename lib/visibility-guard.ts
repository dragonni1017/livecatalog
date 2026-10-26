// A visible $0 product is orderable for free: lib/order-submission.ts checks
// only is_active and manually_hidden. Every single-product edit in
// PATCH /admin/api/products passes through this before it writes.
//
// Judged on the row as it will be after the edit, so both ways in are caught:
// unhiding a $0 product, and zeroing the price of a visible one.

export interface VisibilityState {
  manually_hidden: boolean | null
  price_cents: number | null
}

export type ZeroPriceBlock = 'unhide_unpriced' | 'zero_visible'

export const ZERO_PRICE_BLOCK_TEXT: Record<ZeroPriceBlock, string> = {
  unhide_unpriced:
    'This product has no price, so it can’t be shown: a visible $0 product can be ordered for free. Price it in Erply first.',
  zero_visible:
    'A visible product can’t be set to $0: it could be ordered for free. Hide it first, or enter a real price.',
}

export function zeroPriceBlock(
  current: VisibilityState,
  updates: { manually_hidden?: unknown; price_cents?: unknown },
): ZeroPriceBlock | null {
  const hidden = typeof updates.manually_hidden === 'boolean' ? updates.manually_hidden : current.manually_hidden === true
  if (hidden) return null
  const price = typeof updates.price_cents === 'number' ? updates.price_cents : (current.price_cents ?? 0)
  if (price > 0) return null
  return updates.manually_hidden === false ? 'unhide_unpriced' : 'zero_visible'
}

/** Whether an edit could leave the row visible at $0 and so needs the check. */
export function touchesZeroPriceRule(updates: { manually_hidden?: unknown; price_cents?: unknown }): boolean {
  return updates.manually_hidden === false || (typeof updates.price_cents === 'number' && updates.price_cents <= 0)
}
