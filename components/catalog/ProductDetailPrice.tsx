'use client'

import { useTierDiscount } from '@/lib/use-tier-discount'
import { applyTierDiscount, type VolumeTier } from '@/lib/order-rules'
import type { PriceTier } from '@/lib/rep-tier-shared'

function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}

interface Props {
  priceCents: number
  volumeTiers: VolumeTier[] | null
  tiers: PriceTier[]
}

// Client component for the same reason as ProductCardPrice — reads the
// rep-selected tier client-side so the (ISR-cached) product detail page
// doesn't need a server-side cookie read. See lib/rep-tier.ts.
export default function ProductDetailPrice({ priceCents, volumeTiers, tiers }: Props) {
  const discountPercent = useTierDiscount(tiers)
  const effectiveBaseCents = applyTierDiscount(priceCents, discountPercent)

  if (volumeTiers && volumeTiers.length > 0) {
    return (
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">Volume pricing</p>
        <table className="w-full text-sm">
          <tbody>
            <tr className="border-b border-gray-100">
              <td className="py-1.5 text-gray-500">1+ units</td>
              <td className="py-1.5 text-right font-semibold text-gray-900">
                {formatPrice(effectiveBaseCents)}
                {discountPercent > 0 && (
                  <span className="ml-1.5 text-xs font-normal text-gray-400 line-through">{formatPrice(priceCents)}</span>
                )}
              </td>
            </tr>
            {[...volumeTiers]
              .sort((a, b) => a.min_qty - b.min_qty)
              .map((vt) => {
                const effective = applyTierDiscount(vt.price_cents, discountPercent)
                return (
                  <tr key={vt.min_qty} className="border-b border-gray-100 bg-green-50">
                    <td className="py-1.5 font-medium text-green-800">{vt.min_qty}+ units</td>
                    <td className="py-1.5 text-right font-bold text-green-800">
                      {formatPrice(effective)}
                      {discountPercent > 0 && (
                        <span className="ml-1.5 text-xs font-normal text-green-600 line-through">{formatPrice(vt.price_cents)}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <p className="text-3xl font-bold text-gray-900">
      {formatPrice(effectiveBaseCents)}
      {discountPercent > 0 && (
        <span className="ml-2 text-base font-normal text-gray-400 line-through">{formatPrice(priceCents)}</span>
      )}
    </p>
  )
}
