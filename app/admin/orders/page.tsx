import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'
import OrderStatusBadge from '@/components/admin/OrderStatusBadge'
import type { OrderStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface OrderRow {
  id: string
  reference_code: string
  status: OrderStatus
  customer_name: string
  customer_company: string | null
  subtotal_cents: number
  created_at: string
  order_items: { count: number }[]
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default async function AdminOrdersPage() {
  const db = getAdminClient()
  const { data } = await db
    .from('order_requests')
    .select('id, reference_code, status, customer_name, customer_company, subtotal_cents, created_at, order_items(count)')
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
          <h1 className="mt-2 text-2xl font-bold text-gray-900">Order Requests</h1>
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

        {/* Table */}
        <div className="rounded-xl bg-white border border-gray-200 overflow-hidden">
          <div className="overflow-auto max-h-[640px]">
            <table className="w-full text-sm text-left">
              <thead className="sticky top-0 bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Reference</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Customer</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Items</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Submitted</th>
                  <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Sales order</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.map((o) => (
                  <tr key={o.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/orders/${o.id}`}
                        className="font-mono text-xs font-semibold text-red-600 hover:text-red-700"
                      >
                        {o.reference_code}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-800">
                      <div className="font-medium">{o.customer_company || o.customer_name}</div>
                      {o.customer_company && <div className="text-xs text-gray-500">{o.customer_name}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{o.order_items?.[0]?.count ?? 0}</td>
                    <td className="px-4 py-3 font-semibold text-gray-900">{formatPrice(o.subtotal_cents)}</td>
                    <td className="px-4 py-3"><OrderStatusBadge status={o.status} /></td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDate(o.created_at)}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/orders/${o.id}/print`}
                        target="_blank"
                        className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                      >
                        Print ↗
                      </Link>
                    </td>
                  </tr>
                ))}
                {orders.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">
                      No order requests yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
