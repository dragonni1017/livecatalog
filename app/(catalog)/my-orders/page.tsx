export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'
import { ilikeExact } from '@/lib/order-access'
import { formatPrice } from '@/lib/cart-context'
import type { OrderStatus } from '@/lib/types'
import { getSessionUser } from '@/lib/auth-server'


function statusBadge(status: OrderStatus) {
  switch (status) {
    case 'new':
      return (
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
          Received
        </span>
      )
    case 'contacted':
      return (
        <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
          In Progress
        </span>
      )
    case 'converted':
      return (
        <span className="inline-flex items-center rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
          Confirmed
        </span>
      )
    case 'lost':
      return (
        <span className="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
          Closed
        </span>
      )
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// Lists only the SIGNED-IN account's orders. This used to accept ?email= from
// anyone, with no login, which listed any customer's orders (references,
// names, totals) to whoever typed their address (2026-10-01 /api audit).
// Guests are asked to sign in instead. Same rule as lib/order-access.ts.
export default async function MyOrdersPage() {
  const sessionUser = await getSessionUser()
  const sessionEmail = sessionUser?.email ?? ''
  const trimmedEmail = sessionEmail
  const isLoggedIn = !!sessionEmail

  let orders: Array<{
    id: string
    reference_code: string
    status: string
    customer_name: string
    subtotal_cents: number
    created_at: string
  }> | null = null

  if (trimmedEmail) {
    const db = getAdminClient()
    const { data } = await db
      .from('order_requests')
      .select('id, reference_code, status, customer_name, subtotal_cents, created_at')
      .ilike('customer_email', ilikeExact(trimmedEmail))
      .order('created_at', { ascending: false })
      .limit(50)
    orders = data ?? []
  }

  return (
    <div className="mx-auto max-w-3xl">
      {/* Back link */}
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
          />
        </svg>
        Back to catalog
      </Link>

      {/* Heading */}
      <h1 className="mb-1 text-2xl font-bold text-gray-900">Your Orders</h1>
      {!isLoggedIn && (
        <p className="mb-6 text-sm text-gray-500">
          Sign in to view your order history.
        </p>
      )}

      {/* Email lookup form / logged-in info panel */}
      {isLoggedIn ? (
        <div className="mb-8 rounded-lg bg-gray-50 border border-gray-200 px-4 py-3">
          <p className="text-sm text-gray-600">
            Showing orders for <span className="font-medium text-gray-900">{sessionEmail}</span>.{' '}
            <a href="/account" className="text-red-600 hover:text-red-700 underline">My account</a>
          </p>
        </div>
      ) : (
        <a
          href="/login?from=/my-orders"
          className="mb-8 inline-block rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
        >
          Sign in
        </a>
      )}

      {/* Results */}
      {orders !== null && (
        <div>
          {orders.length === 0 ? (
            <p className="text-sm text-gray-500">
              No orders found for <span className="font-medium">{trimmedEmail}</span>.
            </p>
          ) : (
            <>
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                      <th className="px-4 py-3">Reference</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3 text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {orders.map((o) => (
                      <tr key={o.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <Link
                            href={`/order/${o.reference_code}`}
                            className="font-mono text-red-600 hover:text-red-700 hover:underline"
                          >
                            {o.reference_code}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          {statusBadge(o.status as OrderStatus)}
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          {formatDate(o.created_at)}
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">
                          {formatPrice(o.subtotal_cents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-gray-400">
                Click a reference number to view full order details and reorder.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
