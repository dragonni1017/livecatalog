import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface AuditRow {
  id: string
  action: string
  entity_type: string
  entity_id: string | null
  entity_label: string | null
  old_value: string | null
  new_value: string | null
  performed_by: string
  created_at: string
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

function ActionBadge({ action }: { action: string }) {
  const styles: Record<string, string> = {
    stock_adjust: 'bg-blue-100 text-blue-700',
    order_status_change: 'bg-purple-100 text-purple-700',
    order_qb_toggle: 'bg-gray-100 text-gray-600',
  }
  const cls = styles[action] ?? 'bg-gray-100 text-gray-600'
  const label = action.replace(/_/g, ' ')
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {label}
    </span>
  )
}

export default async function AuditLogPage() {
  let rows: AuditRow[] = []
  let fetchError = false

  try {
    const db = getAdminClient()
    const { data, error } = await db
      .from('audit_log')
      .select('id, action, entity_type, entity_id, entity_label, old_value, new_value, performed_by, created_at')
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) throw error
    rows = (data ?? []) as AuditRow[]
  } catch {
    fetchError = true
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-10">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link
            href="/admin"
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            ← Admin
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
        </div>

        {fetchError && (
          <div className="mb-6 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
            Failed to load audit log. Make sure migration 0009 has been applied in Supabase.
          </div>
        )}

        {!fetchError && rows.length === 0 && (
          <div className="rounded-xl bg-white border border-gray-200 px-6 py-10 text-center text-sm text-gray-500 shadow-sm">
            No audit entries yet. Actions will appear here as admins make changes.
          </div>
        )}

        {!fetchError && rows.length > 0 && (
          <div className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50 text-left">
                  <th className="px-4 py-3 font-medium text-gray-600">Time</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Action</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Entity</th>
                  <th className="px-4 py-3 font-medium text-gray-600">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((row) => {
                  const entityLabel = row.entity_label ?? row.entity_id ?? row.entity_type
                  const hasChange = row.old_value != null || row.new_value != null

                  return (
                    <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {formatTime(row.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <ActionBadge action={row.action} />
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        <span className="font-medium">{entityLabel}</span>
                        <span className="ml-1.5 text-xs text-gray-400">{row.entity_type}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {hasChange ? (
                          <span>
                            {row.old_value != null && (
                              <span className="line-through text-gray-400 mr-1">{row.old_value}</span>
                            )}
                            {row.old_value != null && row.new_value != null && (
                              <span className="mx-1 text-gray-400">→</span>
                            )}
                            {row.new_value != null && (
                              <span className="font-medium text-gray-800">{row.new_value}</span>
                            )}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-4 text-xs text-gray-400">Showing last {rows.length} entries</p>
      </div>
    </div>
  )
}
