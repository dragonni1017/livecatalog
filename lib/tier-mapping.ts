/**
 * Shared Erply tier <-> WooCommerce/Wholesale Suite role mapping.
 *
 * Source of truth for the customer bridge (app/api/webhooks/erply/customers,
 * app/api/webhooks/woo/customers). Mirrors TIER_TO_WOO_ROLE in
 * scripts/assign-woo-tier-roles.mjs — that script is a standalone .mjs and
 * can't import this file, so if you change one, change both. See
 * docs/memory/project-woocommerce-tier-mapping.md for status/history.
 */

export type ErplyTier = 'Base' | 'Wholesale' | 'Retail' | 'Distribution-Chain' | 'Exclusive'

/**
 * Policy decided 2026-08-04, SUPERSEDED same day: any customer with no
 * explicit tier defaults here. Originally Wholesale; changed to Retail once
 * Dragon moved all 3,461 existing Erply customers into Retail and confirmed
 * Retail is the new default going forward too (see
 * docs/memory/project-retail-anchor-pricing-flip.md). Retail still has no
 * Wholesale Suite role on the Woo side (see TIER_TO_WOO_ROLE below) — the
 * webhook routes that read this will skip/log rather than assign a role
 * until that's created.
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
 */
export const TIER_TO_WOO_ROLE: Record<ErplyTier, WooRole | null> = {
  'Distribution-Chain': { slug: 'chain', termId: 45 },
  Wholesale: { slug: 'default_wholesaler', termId: 18 },
  // TODO: create a Wholesale Suite role for Retail, then fill in its slug/termId.
  Retail: null,
  // TODO: create a Wholesale Suite role for Exclusive, then fill in its slug/termId.
  Exclusive: null,
  // Deliberately permanent null — Base is not a customer-assignable role.
  Base: null,
}

export function wooRoleForTier(tier: string): WooRole | null {
  return TIER_TO_WOO_ROLE[tier as ErplyTier] ?? null
}
