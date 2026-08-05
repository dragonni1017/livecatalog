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
}

export default function ReorderButton({ items }: Props) {
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

  return (
    <button
      type="button"
      onClick={handleReorder}
      className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
    >
      Reorder all items
    </button>
  )
}
