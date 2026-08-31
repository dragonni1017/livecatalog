import { getAdminClient } from '@/lib/supabase'
import QbSyncErrors from '@/components/admin/QbSyncErrors'

// A 'sent' row stuck for more than this long (no receiveResponseXML ever
// arrived -- most likely a dropped QBWC connection mid-sync, confirmed via a
// live probe 2026-08-31) is surfaced as "stuck", not just 'error' rows. See
// app/admin/api/qbwc/sync-errors/route.ts for the full explanation.
const STUCK_SENT_THRESHOLD_MINUTES = 10

async function getSyncErrors() {
  const db = getAdminClient()
  const staleBefore = new Date(Date.now() - STUCK_SENT_THRESHOLD_MINUTES * 60_000).toISOString()
  const { data: rows } = await db
    .from('qb_sync_queue')
    .select('id, order_id, status, error_message, updated_at')
    .or(`status.eq.error,and(status.eq.sent,updated_at.lt.${staleBefore})`)
    .order('updated_at', { ascending: false })
  if (!rows || rows.length === 0) return []

  const { data: orders } = await db
    .from('order_requests')
    .select('id, reference_code, customer_name, customer_company')
    .in('id', rows.map((r) => r.order_id))
  const orderById = new Map((orders ?? []).map((o) => [o.id, o]))

  return rows.map((r) => {
    const order = orderById.get(r.order_id)
    return {
      queueId: r.id,
      orderId: r.order_id,
      kind: (r.status === 'sent' ? 'stuck' : 'error') as 'stuck' | 'error',
      referenceCode: order?.reference_code ?? '(order not found)',
      customerLabel: order?.customer_company || order?.customer_name || '',
      errorMessage: r.error_message,
      updatedAt: r.updated_at,
    }
  })
}

export default async function QuickBooksSetupPage() {
  const hasUsername = Boolean(process.env.QBWC_USERNAME)
  const hasPassword = Boolean(process.env.QBWC_PASSWORD)
  const hasFileId = Boolean(process.env.QBWC_FILE_ID)
  const ready = hasUsername && hasPassword && hasFileId
  const syncErrors = ready ? await getSyncErrors() : []

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="mb-6">
          <a href="/admin" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            &larr; Back to dashboard
          </a>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-8">
          <h1 className="text-xl font-bold text-gray-900 mb-2">QuickBooks Web Connector Setup</h1>
          <p className="text-sm text-gray-500 mb-6">
            One-time setup to let QuickBooks Web Connector, running on the Windows machine with
            QuickBooks Desktop, pull approved orders from this site automatically.
          </p>

          {/* Status */}
          <div className="rounded-lg border border-gray-200 px-4 py-4 mb-6 text-sm space-y-2">
            <StatusRow label="QBWC_USERNAME" ok={hasUsername} />
            <StatusRow label="QBWC_PASSWORD" ok={hasPassword} />
            <StatusRow label="QBWC_FILE_ID" ok={hasFileId} />
          </div>

          {!ready ? (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-4 text-sm text-amber-800 space-y-3">
              <p className="font-semibold">Step 1 — Pick a username &amp; password</p>
              <p>
                These are the credentials QuickBooks Web Connector sends when it connects — pick
                anything, they&apos;re not tied to any existing account.
              </p>

              <p className="font-semibold mt-2">Step 2 — Generate a stable file ID</p>
              <p>Run this once in your terminal — save the result, it must never change afterward:</p>
              <pre className="bg-amber-100 rounded px-3 py-2 text-xs overflow-x-auto whitespace-pre-wrap break-all">
                node -e &quot;console.log(require(&apos;crypto&apos;).randomUUID())&quot;
              </pre>

              <p className="font-semibold mt-2">Step 3 — Add to .env.local and Vercel</p>
              <pre className="bg-amber-100 rounded px-3 py-2 text-xs overflow-x-auto whitespace-pre-wrap break-all">
                {'QBWC_USERNAME=<your-chosen-username>\nQBWC_PASSWORD=<your-chosen-password>\nQBWC_FILE_ID=<the-generated-uuid>'}
              </pre>
              <p>
                Add the same three variables in your{' '}
                <a
                  href="https://vercel.com/dashboard"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-amber-900"
                >
                  Vercel project settings
                </a>
                {' '}for production.
              </p>

              <p className="font-semibold mt-2">Step 4 — Redeploy, then come back here</p>
              <p>Once redeployed with all three variables set, this page will show a download button.</p>
            </div>
          ) : (
            <div className="space-y-6 text-sm text-gray-700">
              <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-green-800">
                Configured — ready to generate the connector file.
              </div>

              <ol className="space-y-4">
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-red-100 text-red-700 text-xs font-bold flex items-center justify-center">1</span>
                  <div>
                    <a
                      href="/admin/api/qbwc/qwc-file"
                      className="inline-block rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 transition-colors"
                    >
                      Download .qwc file
                    </a>
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-red-100 text-red-700 text-xs font-bold flex items-center justify-center">2</span>
                  <div>
                    On the Windows machine running QuickBooks Desktop, install{' '}
                    <strong>QuickBooks Web Connector</strong> if it isn&apos;t already, then open the
                    downloaded <code className="font-mono text-xs">.qwc</code> file — it&apos;ll ask
                    QuickBooks to authorize the app.
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-red-100 text-red-700 text-xs font-bold flex items-center justify-center">3</span>
                  <div>
                    When Web Connector asks for a password, enter the{' '}
                    <code className="font-mono text-xs">QBWC_PASSWORD</code> value — it isn&apos;t
                    stored in the .qwc file itself, for security.
                  </div>
                </li>
                <li className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-red-100 text-red-700 text-xs font-bold flex items-center justify-center">4</span>
                  <div>
                    <strong>Test against a sample company file first</strong>, not your live one —
                    confirm a test order creates a correct Sales Order before pointing this at real
                    data. Web Connector polls every 15 minutes by default; adjustable in its own
                    settings.
                  </div>
                </li>
              </ol>

              <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-blue-700">
                <strong>Re-installing on a new machine?</strong> Re-download and re-import this same
                .qwc file — the file ID is stable, so QuickBooks recognizes it as the same
                connection rather than a new one.
              </div>

              <a
                href="/admin/quickbooks/customers"
                className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3 hover:border-red-300 hover:shadow-sm transition-all"
              >
                <div>
                  <p className="font-semibold text-gray-900">Link existing QuickBooks customers</p>
                  <p className="text-gray-500">
                    Match a buyer&apos;s email to their existing QuickBooks record before their first
                    order syncs — avoids creating a duplicate customer.
                  </p>
                </div>
                <span className="text-gray-400">&rarr;</span>
              </a>
            </div>
          )}
        </div>

        <QbSyncErrors initialErrors={syncErrors} />
      </div>
    </div>
  )
}

function StatusRow({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <code className="font-mono text-xs text-gray-600">{label}</code>
      {ok ? (
        <span className="text-green-700 font-medium">Set</span>
      ) : (
        <span className="text-gray-400">Not set</span>
      )}
    </div>
  )
}
