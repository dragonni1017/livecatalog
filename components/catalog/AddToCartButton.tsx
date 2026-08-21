'use client'

import { useState } from 'react'
import { useCart } from '@/lib/cart-context'
import { useTierDiscount } from '@/lib/use-tier-discount'
import { useIsRep } from '@/lib/use-is-rep'
import { applyTierDiscount } from '@/lib/order-rules'
import type { CartItem } from '@/lib/types'
import type { PriceTier } from '@/lib/rep-tier-shared'

interface AddToCartButtonProps {
  product: Omit<CartItem, 'qty'> & { stockQty: number }
  // 'card' is the compact control used inside the ProductCard link; 'detail'
  // is the full-width version on the product page.
  variant?: 'card' | 'detail'
  // Units in one case, parsed from the product name's pack spec (e.g.
  // "cs.144"). When set and stock covers at least one full case, shows a
  // "+1 case" quick-add shortcut next to the stepper.
  unitsPerCase?: number
  // Active price tiers, when known — if a rep has one selected (via the
  // header TierSwitcher), the tier discount is applied to product.priceCents
  // before it's added to the cart, same as what's shown on the page. Omit
  // entirely on pages with no tier concept — behaves exactly as before.
  tiers?: PriceTier[]
}

export default function AddToCartButton({ product, variant = 'card', unitsPerCase, tiers }: AddToCartButtonProps) {
  const { addItem } = useCart()
  const { isRep } = useIsRep()
  const discountPercent = useTierDiscount(tiers ?? [])
  const effectivePriceCents = applyTierDiscount(product.priceCents, discountPercent)
  const [qty, setQty] = useState(1)
  const [justAdded, setJustAdded] = useState(false)
  const outOfStock = product.stockQty <= 0
  const max = product.stockQty > 0 ? product.stockQty : 1
  const canAddCase = !outOfStock && !!unitsPerCase && unitsPerCase > 1 && max >= unitsPerCase

  // Rep-only: override this line's unit price for just this order (see
  // lib/order-submission.ts -- the server only honors this for a verified
  // rep session, same trust boundary as the tier discount above; never
  // trusted from a non-rep client). Blank = use the computed tier price.
  const [showCustomPrice, setShowCustomPrice] = useState(false)
  const [customPrice, setCustomPrice] = useState('')
  const customPriceCents = (() => {
    if (!customPrice.trim()) return null
    const cents = Math.round(parseFloat(customPrice) * 100)
    return Number.isFinite(cents) && cents >= 0 ? cents : null
  })()
  const finalPriceCents = isRep && customPriceCents !== null ? customPriceCents : effectivePriceCents

  function resetCustomPrice() {
    setShowCustomPrice(false)
    setCustomPrice('')
  }

  // ProductCard wraps the whole card in a <Link>; keep clicks on these controls
  // from navigating to the product page.
  function stop(e: React.SyntheticEvent) {
    e.preventDefault()
    e.stopPropagation()
  }

  function clamp(n: number) {
    if (!Number.isFinite(n)) return 1
    return Math.min(max, Math.max(1, Math.floor(n)))
  }

  function handleAdd(e: React.MouseEvent) {
    stop(e)
    if (outOfStock) return
    addItem(
      {
        productId: product.productId,
        sku: product.sku,
        name: product.name,
        priceCents: finalPriceCents,
        imageUrl: product.imageUrl,
        isCustomPrice: isRep && customPriceCents !== null,
      },
      qty,
    )
    setJustAdded(true)
    resetCustomPrice()
    window.setTimeout(() => setJustAdded(false), 1500)
  }

  function handleAddCase(e: React.MouseEvent) {
    stop(e)
    if (!canAddCase || !unitsPerCase) return
    addItem(
      {
        productId: product.productId,
        sku: product.sku,
        name: product.name,
        priceCents: finalPriceCents,
        imageUrl: product.imageUrl,
        isCustomPrice: isRep && customPriceCents !== null,
      },
      unitsPerCase,
    )
    setJustAdded(true)
    resetCustomPrice()
    window.setTimeout(() => setJustAdded(false), 1500)
  }

  if (outOfStock) {
    return (
      <span
        className={
          (variant === 'detail' ? 'block w-full py-3 text-center ' : 'inline-block px-3 py-1.5 ') +
          'rounded-md bg-gray-100 text-xs font-semibold text-gray-400'
        }
      >
        Out of Stock
      </span>
    )
  }

  const detail = variant === 'detail'

  // Shared − [n] + stepper.
  const stepper = (
    <div
      className="flex items-center rounded-md border border-gray-300"
      onClick={stop}
    >
      <button
        type="button"
        aria-label="Decrease quantity"
        onClick={(e) => {
          stop(e)
          setQty((q) => clamp(q - 1))
        }}
        className={
          'flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40 ' +
          (detail ? 'h-11 w-11 text-lg' : 'h-9 w-8 text-sm sm:h-7 sm:w-6')
        }
        disabled={qty <= 1}
      >
        −
      </button>
      <input
        type="number"
        min={1}
        max={max}
        value={qty}
        onClick={stop}
        onChange={(e) => {
          stop(e)
          setQty(clamp(parseInt(e.target.value, 10)))
        }}
        className={
          'border-x border-gray-300 text-center text-gray-900 focus:outline-none ' +
          (detail ? 'h-11 w-14 text-sm' : 'h-9 w-9 text-xs sm:h-7')
        }
      />
      <button
        type="button"
        aria-label="Increase quantity"
        onClick={(e) => {
          stop(e)
          setQty((q) => clamp(q + 1))
        }}
        className={
          'flex items-center justify-center text-gray-600 hover:bg-gray-50 disabled:opacity-40 ' +
          (detail ? 'h-11 w-11 text-lg' : 'h-9 w-8 text-sm sm:h-7 sm:w-6')
        }
        disabled={qty >= max}
      >
        +
      </button>
    </div>
  )

  return (
    <div>
      <div className={detail ? 'flex flex-wrap items-center gap-3' : 'flex flex-wrap items-center gap-1.5'}>
        {stepper}
        <button
          type="button"
          onClick={handleAdd}
          aria-label={`Add ${qty} ${product.name} to cart`}
          className={
            'rounded-md bg-red-600 font-semibold text-white transition-colors hover:bg-red-700 ' +
            (detail ? 'h-11 flex-1 px-4 text-sm' : 'px-3 py-2 text-xs sm:py-1.5')
          }
        >
          {justAdded ? (detail ? 'Added to cart ✓' : 'Added ✓') : detail ? 'Add to Cart' : 'Add'}
        </button>
        {canAddCase && (
          <button
            type="button"
            onClick={handleAddCase}
            aria-label={`Add 1 case (${unitsPerCase} units) of ${product.name} to cart`}
            className={
              'rounded-md border border-red-600 font-semibold text-red-600 transition-colors hover:bg-red-50 ' +
              (detail ? 'h-11 px-4 text-sm' : 'px-2 py-2 text-xs sm:py-1.5')
            }
          >
            + 1 case ({unitsPerCase})
          </button>
        )}
      </div>

      {/* Rep-only: set a one-off price for this line, this order only --
          never changes the product's real price or the selected tier. */}
      {isRep && (
        <div className={detail ? 'mt-2' : 'mt-1'} onClick={stop}>
          {showCustomPrice ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-500">Custom price $</span>
              <input
                type="number"
                min={0}
                step={0.01}
                autoFocus
                value={customPrice}
                onChange={(e) => setCustomPrice(e.target.value)}
                onClick={stop}
                placeholder={(effectivePriceCents / 100).toFixed(2)}
                className="w-20 rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
              />
              <button
                type="button"
                onClick={(e) => { stop(e); resetCustomPrice() }}
                className="text-xs text-gray-400 hover:text-gray-600"
                aria-label="Cancel custom price"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={(e) => { stop(e); setShowCustomPrice(true) }}
              className="text-xs text-amber-700 hover:text-amber-900 underline"
            >
              Custom price for this order
            </button>
          )}
        </div>
      )}
    </div>
  )
}
