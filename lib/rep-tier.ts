/**
 * Server-only rep price-tier helper: a plain DB read (no cookies()/headers()),
 * so it's safe to call from ISR-cached server components like ProductCard —
 * it doesn't force the page out of static rendering. Which tier (if any)
 * actually applies is resolved separately:
 *  - for DISPLAY, client-side (see components/catalog/TierSwitcher.tsx +
 *    lib/use-tier-discount.ts), so anonymous-shopper traffic keeps its
 *    static/ISR caching.
 *  - for the real order price, server-side in app/api/orders/route.ts
 *    (already fully dynamic) via request.cookies — re-verified against a
 *    real rep session and the price_tiers table, never trusted from the
 *    client.
 */
import { cache } from 'react'
import { getAdminClient } from '@/lib/supabase'
import type { PriceTier } from '@/lib/rep-tier-shared'

// React.cache dedupes this within a single request/render pass — ProductCard
// renders once per product in a grid, this only hits Supabase once per page.
export const getActivePriceTiers = cache(async (): Promise<PriceTier[]> => {
  const db = getAdminClient()
  const { data } = await db
    .from('price_tiers')
    .select('code, label, discount_percent')
    .eq('active', true)
    .order('display_order')
  return (data ?? []) as PriceTier[]
})
