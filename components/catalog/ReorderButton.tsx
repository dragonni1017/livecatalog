'use client'

import { useRouter } from 'next/navigation'
import { useCart } from '@/lib/cart-context'

interface ReorderItem {
  productId: string | null
  sku: string
  name: string
  priceCents: number
  qty: number
}

interface Props {
  items: ReorderItem[]
  /** 'compact' for a table row (e.g. /my-orders). */
  variant?: 'primary' | 'compact'
}

export default function ReorderButton({ items, variant = 'primary' }: Props) {
  const { addItem } = useCart()
  const router = useRouter()

  function handleReorder() {
    for (const item of items) {
      if (item.productId === null) continue
      addItem(
        {
          productId: item.productId,
          sku: item.sku,
          name: item.name,
          priceCents: item.priceCents,
          imageUrl: null,
        },
        item.qty,
      )
    }
    router.push('/cart')
  }

  if (!items.some((i) => i.productId !== null)) return null

  return (
    <button
      type="button"
      onClick={handleReorder}
      className={
        variant === 'compact'
          ? 'rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-red-300 hover:text-red-600'
          : 'rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700'
      }
    >
      {variant === 'compact' ? 'Reorder' : 'Reorder all items'}
    </button>
  )
}
