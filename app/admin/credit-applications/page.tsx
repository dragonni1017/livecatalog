import { getAdminClient } from '@/lib/supabase'
import Link from 'next/link'
import CreditApplicationTable, { type CreditApplication } from './CreditApplicationTable'
import { creditHistory, type CreditHistory, type HistoryQbCustomer } from '@/lib/credit-history'

export const dynamic = 'force-dynamic'

export default async function CreditApplicationsPage() {
  const db = getAdminClient()
  const { data: applications } = await db
    .from('credit_applications')
    .select('*')
    .order('created_at', { ascending: false })

  const rows = (applications ?? []) as CreditApplication[]
  const pending = rows.filter((r) => r.status === 'pending').length

  // What we already know about each pending applicant (lib/credit-history.ts).
  // Best-effort: a failed lookup just leaves that part out.
  const history: Record<string, CreditHistory> = {}
  const open = rows.filter((r) => r.status === 'pending')
  if (open.length) {
    const emails = [...new Set(open.flatMap((a) => [a.email, a.email.trim().toLowerCase()]))]
    const qbCustomers: HistoryQbCustomer[] = []
    // Ordered by the primary key: range() paging needs a stable order.
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from('qb_customer_directory')
        .select('full_name, company_name, email')
        .order('qb_customer_list_id')
        .range(from, from + 999)
      if (error || !data) break
      qbCustomers.push(...(data as HistoryQbCustomer[]))
      if (data.length < 1000) break
    }
    const [{ data: orders }, { data: customers }, { data: erplyLinks }] = await Promise.all([
      db.from('order_requests').select('customer_email, status, subtotal_cents, created_at, dismissed_at'),
      db.from('customers').select('email, price_tier_code, created_at').in('email', emails),
      db.from('erply_woo_customer_links').select('email, erply_customer_id, erply_tier').in('email', emails),
    ])
    for (const a of open) {
      history[a.id] = creditHistory(a, {
        orders: orders ?? [],
        customers: customers ?? [],
        qbCustomers,
        erplyLinks: erplyLinks ?? [],
        applications: rows,
      })
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <Link href="/admin" className="text-sm text-red-600 hover:text-red-700">← Admin</Link>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Net-Terms Applications</h1>
        {pending > 0 && (
          <p className="mt-0.5 text-sm font-medium text-amber-700">{pending} pending review</p>
        )}
      </div>

      <CreditApplicationTable initialApplications={rows} history={history} />
    </div>
  )
}
