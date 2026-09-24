import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'
import { isConfigured as isErplyConfigured } from '@/lib/erply'
import { loadShipmentProgress } from '@/lib/receiving-progress'
import ReceivingUpload, { type Shipment } from './ReceivingUpload'

export const dynamic = 'force-dynamic'

export default async function ReceivingPage() {
  const db = getAdminClient()
  const { data: shipments } = await db
    .from('shipments')
    .select('*')
    .order('staged_at', { ascending: false })
    .limit(25)

  // Rendered with the page rather than fetched on mount: the strip is the
  // first thing worth reading, and a client effect that sets state is what
  // this project's lint rules (rightly) refuse.
  const progress = await loadShipmentProgress(db, (shipments ?? []).map((s) => s.id))

  const erplyReady = isErplyConfigured()

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <Link href="/admin" className="text-sm text-red-600 hover:text-red-700">← Admin</Link>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Receiving</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          Upload a supplier packing list, confirm what actually arrived, then register it as stock.
        </p>
      </div>

      {!erplyReady && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-medium">Erply isn&apos;t configured in this environment.</span> You can upload and review
          a packing list here, but applying it will be refused rather than silently doing nothing — stock has to be
          registered from an environment that has the Erply credentials.
        </div>
      )}

      <ReceivingUpload initialShipments={(shipments ?? []) as Shipment[]} initialProgress={progress} />
    </div>
  )
}
