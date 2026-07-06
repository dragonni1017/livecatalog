import { getAdminClient } from '@/lib/supabase'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const STATUS_STYLES: Record<string, string> = {
  pending:  'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  denied:   'bg-red-100 text-red-700',
}

export default async function CreditApplicationsPage() {
  const db = getAdminClient()
  const { data: applications } = await db
    .from('credit_applications')
    .select('*')
    .order('created_at', { ascending: false })

  const rows = applications ?? []
  const pending = rows.filter((r) => r.status === 'pending').length

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link href="/admin" className="text-sm text-red-600 hover:text-red-700">← Admin</Link>
          <h1 className="mt-1 text-2xl font-bold text-gray-900">Net-Terms Applications</h1>
          {pending > 0 && (
            <p className="mt-0.5 text-sm text-amber-700 font-medium">{pending} pending review</p>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white py-16 text-center text-gray-500">
          No applications yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Company</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Contact</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Terms</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Status</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Submitted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((app) => (
                <tr key={app.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900">{app.company_name}</p>
                    {app.address && <p className="text-xs text-gray-400">{app.address}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-gray-900">{app.contact_name}</p>
                    <p className="text-xs text-gray-500">{app.email}</p>
                    {app.phone && <p className="text-xs text-gray-400">{app.phone}</p>}
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">{app.requested_terms}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[app.status] ?? 'bg-gray-100 text-gray-700'}`}>
                      {app.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">
                    {new Date(app.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Detail accordion rows */}
          {rows.filter((a) => a.trade_references || a.notes || a.years_in_business).length > 0 && (
            <div className="border-t border-gray-200 divide-y divide-gray-100">
              {rows
                .filter((a) => a.trade_references || a.notes || a.annual_purchase_estimate || a.years_in_business)
                .map((app) => (
                  <details key={`detail-${app.id}`} className="group">
                    <summary className="cursor-pointer px-4 py-2 text-xs text-gray-500 hover:text-gray-700 list-none flex items-center gap-1">
                      <span className="font-medium text-gray-700">{app.company_name}</span> — details
                      <svg className="h-3 w-3 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </summary>
                    <div className="px-4 pb-3 pt-1 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                      {app.years_in_business && (
                        <div><span className="text-xs text-gray-500">Years in business</span><p>{app.years_in_business}</p></div>
                      )}
                      {app.annual_purchase_estimate && (
                        <div><span className="text-xs text-gray-500">Est. annual purchases</span><p>{app.annual_purchase_estimate}</p></div>
                      )}
                      {app.trade_references && (
                        <div className="col-span-2 sm:col-span-3">
                          <span className="text-xs text-gray-500">Trade references</span>
                          <p className="whitespace-pre-wrap">{app.trade_references}</p>
                        </div>
                      )}
                      {app.notes && (
                        <div className="col-span-2 sm:col-span-3">
                          <span className="text-xs text-gray-500">Notes</span>
                          <p className="whitespace-pre-wrap">{app.notes}</p>
                        </div>
                      )}
                    </div>
                  </details>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
