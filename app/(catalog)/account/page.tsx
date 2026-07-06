export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth-server'
import { getAdminClient } from '@/lib/supabase'
function formatPrice(cents: number) {
  return '$' + (cents / 100).toFixed(2)
}
import type { OrderStatus } from '@/lib/types'
import LogoutButton from './LogoutButton'

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

export default async function AccountPage() {
  const user = await getSessionUser()
  if (!user) {
    redirect('/login?from=/account')
  }

  const db = getAdminClient()
  const { data: orders } = await db
    .from('order_requests')
    .select('id, reference_code, status, customer_name, subtotal_cents, created_at')
    .ilike('customer_email', user.email!)
    .order('created_at', { ascending: false })
    .limit(20)

  const orderList = orders ?? []

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
      <h1 className="mb-1 text-2xl font-bold text-gray-900">My Account</h1>
      <p className="mb-6 text-sm text-gray-500">{user.email}</p>

      {/* Profile card */}
      <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Account Details
        </h2>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs text-gray-400">Name</dt>
            <dd className="mt-0.5 text-sm text-gray-900">
              {user.user_metadata?.name || '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-400">Company</dt>
            <dd className="mt-0.5 text-sm text-gray-900">
              {user.user_metadata?.company || '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-400">Email</dt>
            <dd className="mt-0.5 text-sm text-gray-900">{user.email}</dd>
          </div>
        </dl>
        <div className="mt-4 flex items-center gap-3">
          <Link
            href="/account/settings"
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:border-gray-400 hover:text-gray-900"
          >
            Edit profile
          </Link>
          <LogoutButton />
        </div>
      </div>

      {/* Orders card */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Order History
        </h2>
        {orderList.length === 0 ? (
          <p className="text-sm text-gray-500">No orders yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-100">
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
                {orderList.map((o) => (
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
        )}
      </div>
    </div>
  )
}
