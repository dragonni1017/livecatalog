/**
 * Constants/types shared between server code (lib/rep-tier.ts,
 * app/api/orders/route.ts) and client code (TierSwitcher,
 * lib/use-tier-discount.ts, AddToCartButton). Kept in its own file because
 * lib/rep-tier.ts pulls in getAdminClient() (service-role key) and
 * next/headers — neither may ever end up in a client bundle.
 */
export const TIER_COOKIE = 'rep_tier'
// Dispatched on `window` by TierSwitcher whenever the selected tier changes,
// so every price display on the page updates instantly without a server
// round trip — see lib/use-tier-discount.ts.
export const TIER_CHANGE_EVENT = 'rep-tier-changed'

export interface PriceTier {
  code: string
  label: string
  discount_percent: number
}
