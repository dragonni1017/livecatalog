'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import OrderStatusBadge from '@/components/admin/OrderStatusBadge'
import EnteredInQbToggle from '@/components/admin/EnteredInQbToggle'
import type { OrderStatus } from '@/lib/types'

export interface OrderRow {
  id: string
  reference_code: string
  status: OrderStatus
  customer_name: string
  customer_company: string | null
  subtotal_cents: number
  created_at: string
  entered_in_qb: boolean
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

const STATUS_FILTERS: { value: OrderStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'converted', label: 'Converted' },
  { value: 'lost', label: 'Lost' },
]

export default function OrdersTable({ orders }: { orders: OrderRow[] }) {
  const [status, setStatus] = useState<OrderStatus | 'all'>('all')
  const [qb, setQb] = useState<'all' | 'entered' | 'pending'>('all')
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return orders.filter((o) => {
      if (status !== 'all' && o.status !== status) return false
      if (qb === 'entered' && !o.entered_in_qb) return false
      if (qb === 'pending' && o.entered_in_qb) return false
      if (q) {
        const hay = `${o.reference_code} ${o.customer_name} ${o.customer_company ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [orders, status, qb, search])

  const selectCls =
    'rounded-md border border-gray-300 bg-white py-1.5 pl-2 pr-7 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500'

  return (
    <div>
      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search reference or customer…"
          className="w-full max-w-xs rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder-gray-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value as OrderStatus | 'all')} className={selectCls}>
          {STATUS_FILTERS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select value={qb} onChange={(e) => setQb(e.target.value as 'all' | 'entered' | 'pending')} className={selectCls}>
          <option value="all">QB: all</option>
          <option value="pending">QB: not entered</option>
          <option value="entered">QB: entered</option>
        </select>
        <span className="text-sm text-gray-400">
          {filtered.length} of {orders.length}
        </span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        <div className="overflow-auto max-h-[640px]">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Reference</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Customer</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Items</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Total</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Status</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Submitted</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">QuickBooks</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Sales order</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((o) => (
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
                  <td className="px-4 py-3">
                    <OrderStatusBadge status={o.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatDate(o.created_at)}</td>
                  <td className="px-4 py-3">
                    <EnteredInQbToggle id={o.id} initial={o.entered_in_qb} variant="cell" />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/admin/orders/${o.id}/print`}
                        target="_blank"
                        className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                      >
                        Print ↗
                      </Link>
                      <a
                        href={`/admin/api/orders/${o.id}/excel`}
                        className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                      >
                        Excel
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">
                    {orders.length === 0 ? 'No order requests yet.' : 'No orders match your filters.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
