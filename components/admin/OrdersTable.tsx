'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import OrderStatusBadge from '@/components/admin/OrderStatusBadge'
import EnteredInQbToggle from '@/components/admin/EnteredInQbToggle'
import { tierLabel } from '@/lib/order-rules'
import { DISMISS_REASON_LABELS, isDismissReason } from '@/lib/order-dismiss'
import { isWaiting, waitAge } from '@/lib/order-age'
import type { OrderStatus } from '@/lib/types'

export interface OrderRow {
  id: string
  reference_code: string
  status: OrderStatus
  customer_name: string
  customer_company: string | null
  customer_email: string | null
  subtotal_cents: number
  created_at: string
  entered_in_qb: boolean
  notes: string | null
  applied_tier_code: string | null
  dismissed_at: string | null
  dismissed_reason: string | null
  assigned_rep_email: string | null
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

const WAIT_STYLES = {
  fresh: 'bg-gray-100 text-gray-600',
  amber: 'bg-amber-100 text-amber-800',
  red: 'bg-red-100 text-red-700',
} as const

function WaitBadge({ createdAt, nowIso }: { createdAt: string; nowIso: string }) {
  const a = waitAge(createdAt, nowIso)
  const text = a.calendarDays === 0 ? 'Waiting: today' : `Waiting ${a.calendarDays}d`
  return (
    <span
      className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${WAIT_STYLES[a.level]}`}
      title={`${a.businessDays} business day${a.businessDays === 1 ? '' : 's'} without a response`}
    >
      {text}
    </span>
  )
}

export default function OrdersTable({
  orders,
  initialSearch,
  initialFollowUp = false,
  nowIso,
}: {
  orders: OrderRow[]
  initialSearch?: string
  /** Start on "Needs follow-up" (/admin/orders?view=followup, the dashboard link). */
  initialFollowUp?: boolean
  nowIso: string
}) {
  // Needs follow-up: waiting orders only (new, not dismissed), oldest first.
  const [followUp, setFollowUp] = useState(initialFollowUp)
  const waitingCount = useMemo(() => orders.filter(isWaiting).length, [orders])
  const [status, setStatus] = useState<OrderStatus | 'all'>('all')
  const [qb, setQb] = useState<'all' | 'entered' | 'pending'>('all')
  const [search, setSearch] = useState(initialSearch ?? '')
  // Dismissed test/duplicate/spam requests are hidden unless asked for.
  const [showDismissed, setShowDismissed] = useState(false)
  const dismissedCount = useMemo(() => orders.filter((o) => o.dismissed_at).length, [orders])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const rows = orders.filter((o) => {
      if (followUp && !isWaiting(o)) return false
      if (!showDismissed && o.dismissed_at) return false
      if (status !== 'all' && o.status !== status) return false
      if (qb === 'entered' && !o.entered_in_qb) return false
      if (qb === 'pending' && o.entered_in_qb) return false
      if (q) {
        const hay = `${o.reference_code} ${o.customer_name} ${o.customer_company ?? ''} ${o.customer_email ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    return followUp ? [...rows].sort((a, b) => a.created_at.localeCompare(b.created_at)) : rows
  }, [orders, status, qb, search, showDismissed, followUp])

  const selectCls =
    'rounded-md border border-gray-300 bg-white py-1.5 pl-2 pr-7 text-sm text-gray-900 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500'

  return (
    <div>
      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setFollowUp((v) => !v)}
          className={
            'rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ' +
            (followUp ? 'bg-red-600 text-white hover:bg-red-700' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50')
          }
        >
          Needs follow-up ({waitingCount})
        </button>
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
        {dismissedCount > 0 && (
          <label className="flex items-center gap-1.5 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={showDismissed}
              onChange={(e) => setShowDismissed(e.target.checked)}
              className="rounded border-gray-300 text-red-600 focus:ring-red-500"
            />
            Show dismissed ({dismissedCount})
          </label>
        )}
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
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Owner</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Submitted</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">QuickBooks</th>
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500">Sales order</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((o) => (
                <tr key={o.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <Link
                        href={`/admin/orders/${o.id}`}
                        className="font-mono text-xs font-semibold text-red-600 hover:text-red-700"
                      >
                        {o.reference_code}
                      </Link>
                      {(() => {
                        // Matches both the current "[Ship by DATE]" prefix and
                        // the older "[Needed by DATE]" one, for orders placed
                        // before the field was relabeled.
                        const m = o.notes?.match(/^\[(?:Ship by|Needed by) (\d{4}-\d{2}-\d{2})\]/)
                        return m && (
                          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
                            Ship by {m[1]}
                          </span>
                        )
                      })()}
                      {o.applied_tier_code && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                          {tierLabel(o.applied_tier_code)}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-800">
                    <div className="font-medium">{o.customer_company || o.customer_name}</div>
                    {o.customer_company && <div className="text-xs text-gray-500">{o.customer_name}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{o.order_items?.[0]?.count ?? 0}</td>
                  <td className="px-4 py-3 font-semibold text-gray-900">{formatPrice(o.subtotal_cents)}</td>
                  <td className="px-4 py-3">
                    {o.dismissed_at ? (
                      <span className="inline-flex rounded-full bg-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-600">
                        Dismissed: {isDismissReason(o.dismissed_reason) ? DISMISS_REASON_LABELS[o.dismissed_reason] : o.dismissed_reason}
                      </span>
                    ) : (
                      <div className="flex flex-col items-start">
                        <OrderStatusBadge status={o.status} />
                        {isWaiting(o) && <WaitBadge createdAt={o.created_at} nowIso={nowIso} />}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600" title={o.assigned_rep_email ?? undefined}>
                    {o.assigned_rep_email ? o.assigned_rep_email.split('@')[0] : <span className="text-gray-400">Unassigned</span>}
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
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-400">
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
