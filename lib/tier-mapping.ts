/**
 * Shared Erply tier <-> WooCommerce/Wholesale Suite role mapping.
 *
 * Source of truth for the customer bridge: app/api/sync/customers/route.ts
 * (daily cron) and the dormant webhook scaffolding in
 * app/api/webhooks/erply/customers, app/api/webhooks/woo/customers. Mirrors
 * TIER_TO_WOO_ROLE in scripts/assign-woo-tier-roles.mjs and
 * scripts/backfill-erply-customers-to-woo.mjs — those are standalone .mjs
 * and can't import this file, so if you change one, change all three. See
 * docs/memory/project-woocommerce-tier-mapping.md for status/history.
 */

export type ErplyTier = 'Base' | 'Wholesale' | 'Retail' | 'Distribution-Chain' | 'Exclusive'

/**
 * Policy decided 2026-08-04, SUPERSEDED same day: any customer with no
 * explicit tier defaults here. Originally Wholesale; changed to Retail once
 * Dragon moved all 3,461 existing Erply customers into Retail and confirmed
 * Retail is the new default going forward too (see
 * docs/memory/project-retail-anchor-pricing-flip.md).
 */
export const DEFAULT_TIER: ErplyTier = 'Retail'

interface WooRole {
  slug: string
  termId: number
}

/**
 * `null` means no Wholesale Suite role exists yet for that tier — callers
 * must skip (never fall back to another role) until it's filled in here.
 * Base is intentionally always null: no customer should ever be assigned it.
 * All 5 term_ids reconfirmed live 2026-08-07 via GET wp-json/wholesale/v1/roles.
 */
export const TIER_TO_WOO_ROLE: Record<ErplyTier, WooRole | null> = {
  'Distribution-Chain': { slug: 'chain', termId: 45 },
  Wholesale: { slug: 'default_wholesaler', termId: 18 },
  Retail: { slug: 'retail', termId: 204 },
  Exclusive: { slug: 'exclusive', termId: 203 },
  // Deliberately permanent null — Base is not a customer-assignable role.
  Base: null,
}

export function wooRoleForTier(tier: string): WooRole | null {
  return TIER_TO_WOO_ROLE[tier as ErplyTier] ?? null
}
