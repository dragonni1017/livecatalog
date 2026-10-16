import type { getAdminClient } from '@/lib/supabase'

// A customer's pricing, decided ONE way everywhere it's shown or charged:
// the order charge (app/api/orders), the cart preview (app/api/cart/reprice)
// and priced line cards / price lists (lib/price-scope.ts).
//
// Rule: an assigned price tier that is active wins; otherwise the customer's
// flat discount_percent; otherwise nothing. Never stacked. The discount is
// then applied with applyTierDiscount (lib/order-rules.ts).
//
// Before 2026-10-16 the cart preview only looked at the tier, so a customer
// with a flat discount saw full price in the cart and was charged less on
// the order. No customer had a flat discount then, so it never bit.

export interface CustomerPricingRow {
  discount_percent: number | string | null
  price_tier_code: string | null
}

export interface TierRow {
  code: string
  label?: string | null
  discount_percent: number | string
  active: boolean
}

export interface CustomerPricing {
  discountPct: number
  /** The tier that priced it, or null when the flat discount (or nothing) applied. */
  tierCode: string | null
  tierLabel: string | null
}

const NONE: CustomerPricing = { discountPct: 0, tierCode: null, tierLabel: null }

/** Pure decision, given the customer's row and their assigned tier's row (if any). */
export function pickCustomerPricing(customer: CustomerPricingRow | null, tier: TierRow | null): CustomerPricing {
  if (!customer) return NONE
  if (customer.price_tier_code && tier && tier.active && tier.code === customer.price_tier_code) {
    return { discountPct: Number(tier.discount_percent), tierCode: tier.code, tierLabel: tier.label ?? null }
  }
  const flat = Number(customer.discount_percent ?? 0)
  return { discountPct: Number.isFinite(flat) ? flat : 0, tierCode: null, tierLabel: null }
}

/** Looks up a customer by email (case-insensitive) and decides their pricing. */
export async function resolveCustomerPricing(
  db: ReturnType<typeof getAdminClient>,
  email: string,
): Promise<CustomerPricing> {
  const { data: customer } = await db
    .from('customers')
    .select('discount_percent, price_tier_code')
    .eq('email', email.trim().toLowerCase())
    .maybeSingle()
  if (!customer) return NONE

  let tier: TierRow | null = null
  if (customer.price_tier_code) {
    const { data } = await db
      .from('price_tiers')
      .select('code, label, discount_percent, active')
      .eq('code', customer.price_tier_code)
      .maybeSingle()
    tier = (data as TierRow | null) ?? null
  }
  return pickCustomerPricing(customer as CustomerPricingRow, tier)
}
