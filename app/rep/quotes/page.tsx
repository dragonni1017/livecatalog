import Link from 'next/link'
import { getSessionUser } from '@/lib/auth-server'
import { getAdminClient } from '@/lib/supabase'
import { ilikeExact } from '@/lib/order-access'
import { attributeOrder, summarize, type AttributableOrder } from '@/lib/rep-attribution'
import { loadRepAccounts } from '@/lib/rep-accounts'

export const dynamic = 'force-dynamic'

// A rep's own quotes: every order credited to them by the same rule as
// /admin/reps (lib/rep-attribution.ts). middleware.ts gates /rep/* to the rep
// role. Shows only what a rep needs to follow up; the full order page link
// appears only where order-access already lets this rep open it (orders they
// placed while signed in).

interface QuoteRow extends AttributableOrder {
  customer_name: string | null
  customer_company: string | null
  customer_email: string | null
}

const STATUS: Record<string, { label: string; cls: string }> = {
  new: { label: 'New', cls: 'bg-blue-100 text-blue-700' },
  contacted: { label: 'Contacted', cls: 'bg-yellow-100 text-yellow-800' },
  converted: { label: 'Converted', cls: 'bg-green-100 text-green-700' },
  lost: { label: 'Lost', cls: 'bg-gray-100 text-gray-500' },
}

function dollars(cents: number): string {
  return '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </div>
  )
}

function monthStartPacificIso(now = new Date()): string {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit' }).format(now).split('-')
  // Midnight PT on the 1st is 07:00 or 08:00 UTC; 08:00 is safe for both.
  return new Date(`${y}-${m}-01T08:00:00Z`).toISOString()
}

export default async function RepQuotesPage() {
  const user = await getSessionUser()
  const db = getAdminClient()
  const email = user?.email ?? ''
  const fields = 'id, reference_code, created_at, status, subtotal_cents, placed_by_rep, rep_user_id, customer_name, customer_company, customer_email'

  const [byUser, byEmail, reps] = await Promise.all([
    user ? db.from('order_requests').select(fields).eq('rep_user_id', user.id) : Promise.resolve({ data: [] }),
    email ? db.from('order_requests').select(fields).ilike('placed_by_rep', ilikeExact(email)) : Promise.resolve({ data: [] }),
    loadRepAccounts(db),
  ])
  const seen = new Map<string, QuoteRow>()
  for (const o of [...((byUser.data ?? []) as QuoteRow[]), ...((byEmail.data ?? []) as QuoteRow[])]) seen.set(o.id, o)
  // Same credit rule as the admin page, so the two always agree.
  const mine = [...seen.values()]
    .filter((o) => {
      const a = attributeOrder(o, reps)
      return a.kind === 'rep' && a.repId === user?.id
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))

  const all = summarize(mine)
  const monthStart = monthStartPacificIso()
  const month = summarize(mine.filter((o) => o.created_at >= monthStart))

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-4xl px-4 py-10">
        <Link href="/rep" className="text-sm text-gray-500 hover:text-gray-700">← Rep Account</Link>
        <h1 className="mt-2 text-2xl font-bold text-gray-900">My Quotes</h1>
        <p className="mb-6 text-sm text-gray-500">
          Quote requests credited to you: you were chosen in &quot;Placed by (rep)&quot; (or the customer used your link), or you
          placed it while signed in.
        </p>

        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card label="This month" value={String(month.orders)} sub={dollars(month.quoteValueCents)} />
          <Card label="Open (new or contacted)" value={String(all.open)} sub={dollars(all.openValueCents)} />
          <Card label="Converted (all time)" value={String(all.converted)} sub={dollars(all.convertedValueCents)} />
          <Card label="All time" value={String(all.orders)} sub={all.orders ? `${Math.round((all.converted / all.orders) * 100)}% converted` : undefined} />
        </div>

        {mine.length === 0 ? (
          <div className="rounded-xl border border-gray-200 bg-white px-6 py-10 text-center text-sm text-gray-500">
            No quotes credited to you yet. Share your catalog link, or choose yourself in &quot;Placed by (rep)&quot; when
            ordering for a customer.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3">Quote</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3 text-right">Value</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {mine.map((o) => {
                  const st = STATUS[o.status] ?? { label: o.status, cls: 'bg-gray-100 text-gray-600' }
                  return (
                    <tr key={o.id}>
                      <td className="px-4 py-3 font-mono text-xs">
                        {o.rep_user_id === user?.id ? (
                          <Link href={`/order/${o.reference_code}`} className="text-red-600 hover:underline">
                            {o.reference_code}
                          </Link>
                        ) : (
                          o.reference_code
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                        {new Date(o.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' })}
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-gray-900">{o.customer_company || o.customer_name || '—'}</div>
                        {o.customer_email && (
                          <a href={`mailto:${o.customer_email}`} className="text-xs text-red-600 hover:underline">
                            {o.customer_email}
                          </a>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{dollars(o.subtotal_cents ?? 0)}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
