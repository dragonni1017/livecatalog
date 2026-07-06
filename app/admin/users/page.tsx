import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default async function AdminUsersPage() {
  const db = getAdminClient()
  const { data, error } = await db.auth.admin.listUsers({ perPage: 200 })
  const users = error ? [] : (data?.users ?? [])

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-10">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-6 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Dashboard
        </Link>

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Registered Users</h1>
            <p className="text-sm text-gray-500 mt-1">
              Supabase Auth accounts — buyers who signed up for order history access
            </p>
          </div>
          <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-600">
            {users.length} {users.length === 1 ? 'user' : 'users'}
          </span>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Failed to load users. Check that SUPABASE_SERVICE_ROLE_KEY is set.
          </div>
        )}

        <div className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
          {users.length === 0 ? (
            <div className="px-6 py-16 text-center text-sm text-gray-500">
              No registered users yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Name / Company</th>
                    <th className="px-4 py-3">Confirmed</th>
                    <th className="px-4 py-3">Signed up</th>
                    <th className="px-4 py-3">Last login</th>
                    <th className="px-4 py-3">Orders</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {users.map((u) => (
                    <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-gray-900 font-medium">{u.email}</td>
                      <td className="px-4 py-3 text-gray-600">
                        {u.user_metadata?.name || u.user_metadata?.company ? (
                          <div>
                            {u.user_metadata?.name && <div>{u.user_metadata.name}</div>}
                            {u.user_metadata?.company && (
                              <div className="text-xs text-gray-400">{u.user_metadata.company}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {u.email_confirmed_at ? (
                          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                            Confirmed
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-700">
                            Pending
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(u.created_at)}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(u.last_sign_in_at ?? null)}</td>
                      <td className="px-4 py-3">
                        {u.email ? (
                          <Link
                            href={`/admin/orders?email=${encodeURIComponent(u.email)}`}
                            className="text-xs font-medium text-red-600 hover:text-red-700 hover:underline"
                          >
                            View orders →
                          </Link>
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
