import { getAdminClient } from '@/lib/supabase'
import QbCustomerMatcher from '@/components/admin/QbCustomerMatcher'

export const dynamic = 'force-dynamic'

// See app/admin/api/qbwc/{customer-pull,customer-directory,customer-links}
// for the mutations, and app/api/qbwc/route.ts's customer_full_query branch
// for how the actual QuickBooks pull runs.
export default async function QbCustomersPage() {
  const db = getAdminClient()

  const { data: pull } = await db
    .from('qb_customer_pull_state')
    .select('status, pulled_count, error_message, requested_at, completed_at')
    .eq('id', 1)
    .maybeSingle()

  const { count: directoryCount } = await db
    .from('qb_customer_directory')
    .select('qb_customer_list_id', { count: 'exact', head: true })

  const { data: orders } = await db
    .from('order_requests')
    .select('customer_email, customer_name, customer_company, created_at')
    .order('created_at', { ascending: false })
    .limit(500)

  const { data: links } = await db
    .from('qb_customer_links')
    .select('email, qb_customer_list_id, qb_customer_full_name, last_sync_source')
  const linkByEmail = new Map((links ?? []).map((l) => [l.email, l]))

  const seen = new Set<string>()
  const buyers: Array<{
    email: string
    name: string
    company: string | null
    lastOrderAt: string
    link: { qb_customer_list_id: string | null; qb_customer_full_name: string | null; last_sync_source: string | null } | null
  }> = []
  for (const o of orders ?? []) {
    const email = o.customer_email.toLowerCase()
    if (seen.has(email)) continue
    seen.add(email)
    const link = linkByEmail.get(email)
    buyers.push({
      email,
      name: o.customer_name,
      company: o.customer_company,
      lastOrderAt: o.created_at,
      link: link
        ? { qb_customer_list_id: link.qb_customer_list_id, qb_customer_full_name: link.qb_customer_full_name, last_sync_source: link.last_sync_source }
        : null,
    })
  }

  return (
    <QbCustomerMatcher
      initialPull={pull ?? { status: 'idle', pulled_count: 0, error_message: null, requested_at: null, completed_at: null }}
      initialDirectoryCount={directoryCount ?? 0}
      initialBuyers={buyers}
    />
  )
}
