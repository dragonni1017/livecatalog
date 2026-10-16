import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'
import type { ResaleCertificate } from '@/lib/resale-certificates'
import ResaleCertificateTable from './ResaleCertificateTable'

export const dynamic = 'force-dynamic'

// Customers' resale / tax-exempt certificates (migration 0057). Active ones
// only by default; ?all=1 also shows ones a newer upload replaced.
export default async function ResaleCertificatesPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>
}) {
  const { all } = await searchParams
  const showAll = all === '1'

  const db = getAdminClient()
  let query = db.from('resale_certificates').select('*').order('created_at', { ascending: false })
  if (!showAll) query = query.is('replaced_at', null)
  const { data, error } = await query

  const rows = (data ?? []) as ResaleCertificate[]
  const pending = rows.filter((r) => r.status === 'pending' && !r.replaced_at).length

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <Link href="/admin" className="text-sm text-red-600 hover:text-red-700">← Admin</Link>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Resale Certificates</h1>
        {pending > 0 && <p className="mt-0.5 text-sm font-medium text-amber-700">{pending} pending review</p>}
        <p className="mt-1 text-sm text-gray-500">
          Uploaded by customers on their account page. Verifying or rejecting only records the decision. It
          doesn&apos;t email the customer or change QuickBooks.{' '}
          <Link href={showAll ? '?' : '?all=1'} className="text-red-600 hover:text-red-700">
            {showAll ? 'Show active only' : 'Include replaced certificates'}
          </Link>
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Couldn&apos;t load certificates. If this is a new install, run{' '}
          <code className="font-mono">supabase/migrations/0057_resale_certificates.sql</code>.
        </p>
      ) : (
        <ResaleCertificateTable initialCertificates={rows} />
      )}
    </div>
  )
}
