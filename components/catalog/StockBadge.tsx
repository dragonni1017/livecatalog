import { getStockStatus } from '@/lib/mock-data'

interface StockBadgeProps {
  qty: number
}

export default function StockBadge({ qty }: StockBadgeProps) {
  const status = getStockStatus(qty)

  if (status === 'in-stock') {
    return (
      <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
        In Stock
      </span>
    )
  }

  if (status === 'low-stock') {
    return (
      <span className="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
        Low Stock
      </span>
    )
  }

  return (
    <span className="inline-flex items-center rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
      Out of Stock
    </span>
  )
}
