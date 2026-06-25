import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'
import OrdersTable, { type OrderRow } from '@/components/admin/OrdersTable'

export const dynamic = 'force-dynamic'

export default async function AdminOrdersPage() {
  const db = getAdminClient()
  const { data } = await db
    .from('order_requests')
    .select('id, reference_code, status, customer_name, customer_company, subtotal_cents, created_at, entered_in_qb, order_items(count)')
    .order('created_at', { ascending: false })

  const orders = (data ?? []) as OrderRow[]
  const openCount = orders.filter((o) => o.status === 'new').length

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="mb-6">
          <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            ← Back to Dashboard
          </Link>
          <div className="mt-2 flex items-center justify-between gap-4">
            <h1 className="text-2xl font-bold text-gray-900">Order Requests</h1>
            <a
              href="/admin/api/orders/export"
              className="shrink-0 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
            >
              Export CSV
            </a>
          </div>
        </div>

        {/* Counts */}
        <div className="mb-6 flex flex-wrap gap-4 text-sm">
          <span className="rounded-lg bg-white border border-gray-200 px-4 py-2 text-gray-700">
            <span className="font-semibold text-gray-900">{orders.length.toLocaleString()}</span> total
          </span>
          <span className="rounded-lg bg-white border border-gray-200 px-4 py-2 text-gray-700">
            <span className="font-semibold text-gray-900">{openCount.toLocaleString()}</span> new
          </span>
        </div>

        {/* Table with filters/search */}
        <OrdersTable orders={orders} />
      </div>
    </div>
  )
}
