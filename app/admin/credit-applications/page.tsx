import { getAdminClient } from '@/lib/supabase'
import Link from 'next/link'
import CreditApplicationTable, { type CreditApplication } from './CreditApplicationTable'

export const dynamic = 'force-dynamic'

export default async function CreditApplicationsPage() {
  const db = getAdminClient()
  const { data: applications } = await db
    .from('credit_applications')
    .select('*')
    .order('created_at', { ascending: false })

  const rows = (applications ?? []) as CreditApplication[]
  const pending = rows.filter((r) => r.status === 'pending').length

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <Link href="/admin" className="text-sm text-red-600 hover:text-red-700">← Admin</Link>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Net-Terms Applications</h1>
        {pending > 0 && (
          <p className="mt-0.5 text-sm font-medium text-amber-700">{pending} pending review</p>
        )}
      </div>

      <CreditApplicationTable initialApplications={rows} />
    </div>
  )
}
