import Link from 'next/link'
import { getSessionUser } from '@/lib/auth-server'
import { getAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Placeholder landing page for the /rep role — confirms login + the
// price_tiers schema end-to-end. The actual order-builder (tier selection,
// live price preview, submit) is the next phase of this feature; see
// docs/memory (or the approved plan) for the full build sequence.
export default async function RepHomePage() {
  const user = await getSessionUser()
  const db = getAdminClient()
  const { data: tiers } = await db
    .from('price_tiers')
    .select('code, label, discount_percent, active')
    .order('display_order')

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Rep Portal</h1>
            <p className="text-sm text-gray-500 mt-1">Signed in as {user?.email}</p>
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/rep/order"
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
            >
              New order
            </Link>
            <Link
              href="/rep/2fa-setup"
              className="text-sm text-gray-500 hover:text-gray-700 underline"
            >
              2FA setup
            </Link>
            <a
              href="/api/rep/auth?action=logout"
              className="text-sm text-gray-500 hover:text-gray-700 underline"
            >
              Sign out
            </a>
          </div>
        </div>

        <div className="rounded-xl bg-white border border-gray-200 shadow-sm p-6">
          <h2 className="text-base font-semibold text-gray-900 mb-1">Price tiers</h2>
          <p className="text-sm text-gray-500 mb-4">
            Reference for the tiers available in the order builder.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <th className="py-2">Tier</th>
                <th className="py-2 text-right">Discount</th>
                <th className="py-2 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(tiers ?? []).map((t) => (
                <tr key={t.code}>
                  <td className="py-2 text-gray-900">{t.label}</td>
                  <td className="py-2 text-right tabular-nums text-gray-700">
                    {t.discount_percent > 0 ? `${t.discount_percent}% off` : '—'}
                  </td>
                  <td className="py-2 text-right">
                    {t.active ? (
                      <span className="text-green-700">Active</span>
                    ) : (
                      <span className="text-gray-400">Inactive</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
