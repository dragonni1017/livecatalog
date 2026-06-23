'use client'

import { useState } from 'react'
import { useCart } from '@/lib/cart-context'
import type { CartItem } from '@/lib/types'

interface AddToCartButtonProps {
  product: Omit<CartItem, 'qty'> & { stockQty: number }
  // 'card' is the compact button used inside the ProductCard link; 'detail'
  // is the full-width button on the product page.
  variant?: 'card' | 'detail'
}

export default function AddToCartButton({ product, variant = 'card' }: AddToCartButtonProps) {
  const { addItem } = useCart()
  const [justAdded, setJustAdded] = useState(false)
  const outOfStock = product.stockQty <= 0

  function handleAdd(e: React.MouseEvent) {
    // ProductCard wraps the whole card in a <Link>; keep the click from
    // navigating to the product page when the button is pressed.
    e.preventDefault()
    e.stopPropagation()
    if (outOfStock) return
    addItem({
      productId: product.productId,
      sku: product.sku,
      name: product.name,
      priceCents: product.priceCents,
      imageUrl: product.imageUrl,
    })
    setJustAdded(true)
    window.setTimeout(() => setJustAdded(false), 1500)
  }

  if (variant === 'detail') {
    return (
      <button
        type="button"
        onClick={handleAdd}
        disabled={outOfStock}
        className={
          'w-full rounded-md px-4 py-3 text-sm font-semibold transition-colors ' +
          (outOfStock
            ? 'cursor-not-allowed bg-gray-100 text-gray-400'
            : 'bg-red-600 text-white hover:bg-red-700')
        }
      >
        {outOfStock ? 'Out of Stock' : justAdded ? 'Added to cart ✓' : 'Add to Cart'}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={handleAdd}
      disabled={outOfStock}
      aria-label={outOfStock ? 'Out of stock' : `Add ${product.name} to cart`}
      className={
        'shrink-0 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ' +
        (outOfStock
          ? 'cursor-not-allowed bg-gray-100 text-gray-400'
          : 'bg-red-600 text-white hover:bg-red-700')
      }
    >
      {outOfStock ? 'Out' : justAdded ? 'Added ✓' : 'Add'}
    </button>
  )
}
