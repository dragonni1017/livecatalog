import type { OrderStatus } from '@/lib/types'

const STYLES: Record<OrderStatus, string> = {
  new: 'bg-blue-100 text-blue-700',
  contacted: 'bg-amber-100 text-amber-700',
  converted: 'bg-green-100 text-green-700',
  lost: 'bg-gray-100 text-gray-500',
}

const LABELS: Record<OrderStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  converted: 'Converted',
  lost: 'Lost',
}

export default function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${STYLES[status] ?? STYLES.new}`}>
      {LABELS[status] ?? status}
    </span>
  )
}
