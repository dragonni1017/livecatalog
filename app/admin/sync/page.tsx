import Link from 'next/link'
import { isConfigured } from '@/lib/erply'
import SyncControls from '@/components/admin/SyncControls'

export const dynamic = 'force-dynamic'

export default function AdminSyncPage() {
  const configured = isConfigured()

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="mb-6">
          <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            ← Back to Dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">Erply Sync</h1>
          <p className="text-sm text-gray-500">
            Pull products + stock from Erply into the catalog. The cron runs daily automatically once
            configured; use this page to preview changes or trigger a sync on demand.
          </p>
        </div>

        <div className="mb-6 flex items-center gap-2 text-sm">
          <span className="text-gray-500">Status:</span>
          {configured ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 font-semibold text-green-700">
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" /> Erply configured
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 font-semibold text-gray-500">
              <span className="h-1.5 w-1.5 rounded-full bg-gray-400" /> Not configured (stub mode)
            </span>
          )}
        </div>

        <SyncControls configured={configured} />
      </div>
    </div>
  )
}
