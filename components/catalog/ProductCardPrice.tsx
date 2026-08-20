'use client'

import { useTierDiscount } from '@/lib/use-tier-discount'
import { applyTierDiscount } from '@/lib/order-rules'
import type { PriceTier } from '@/lib/rep-tier-shared'

function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}

// Client component so it can read the rep-selected tier (client-side cookie,
// set by TierSwitcher) without the parent ProductCard — rendered on every
// catalog page — needing a server-side cookie read that would force those
// pages out of ISR/static rendering. See lib/rep-tier.ts.
export default function ProductCardPrice({ priceCents, tiers }: { priceCents: number; tiers: PriceTier[] }) {
  const discountPercent = useTierDiscount(tiers)
  const effectiveCents = applyTierDiscount(priceCents, discountPercent)

  return (
    <span className="text-base font-bold text-gray-900">
      {formatPrice(effectiveCents)}
      {discountPercent > 0 && (
        <span className="ml-1.5 text-xs font-normal text-gray-400 line-through">{formatPrice(priceCents)}</span>
      )}
    </span>
  )
}
