import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'
import BinCapacityManager from '@/components/admin/BinCapacityManager'
import { binTypeIsUsable } from '@/lib/measurements'

export const dynamic = 'force-dynamic'

// Bin capacity (migration 0046). Erply owns which bins exist -- they're
// mirrored in by scripts/seed-bins-from-erply.mjs -- and this screen records
// how big they are, because Erply's bin record has no dimension or
// weight-limit field at all.
//
// Capacity is entered per bin *type* rather than per bin: the 516 racks are
// aisle-rack-level codes in a handful of physical shapes, so measuring each
// separately would be busywork that drifts.

interface BinTypeRow {
  id: string
  name: string
  length_in: number | null
  width_in: number | null
  height_in: number | null
  max_weight_lb: number | null
  notes: string | null
}

interface BinRow {
  id: string
  code: string
  status: string
  bin_type_id: string | null
  erply_warehouse_id: number | null
}

// Ordered by a unique column. range() pagination over a non-unique sort
// silently duplicates rows into one page and drops them from another -- it
// cost 560 products on the measurements screen before being caught.
async function fetchBins(db: ReturnType<typeof getAdminClient>): Promise<BinRow[]> {
  const all: BinRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('bins')
      .select('id, code, status, bin_type_id, erply_warehouse_id')
      .order('code', { ascending: true })
      .range(from, from + 999)
    if (error) throw error
    const batch = (data ?? []) as unknown as BinRow[]
    all.push(...batch)
    if (batch.length < 1000) break
  }
  return all
}

export default async function AdminBinsPage() {
  const db = getAdminClient()

  const { data: typeData, error: typeError } = await db
    .from('bin_types')
    .select('id, name, length_in, width_in, height_in, max_weight_lb, notes')
    .order('name')

  // The migration is applied by hand in the Supabase SQL editor, so this
  // screen can legitimately load before the tables exist. Say so plainly
  // instead of surfacing a PostgREST schema-cache error.
  if (typeError) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-3xl mx-auto px-4 py-10">
          <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700">
            ← Back to Dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">Bin Capacity</h1>
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
            <p className="font-semibold">The bin tables don&apos;t exist yet.</p>
            <p className="mt-1">
              Apply <code>supabase/migrations/0046_bin_capacity.sql</code> in the Supabase SQL editor, then run{' '}
              <code>node scripts/seed-bins-from-erply.mjs --apply</code> to mirror the bins in from Erply.
            </p>
          </div>
        </div>
      </div>
    )
  }

  const binTypes = (typeData ?? []) as unknown as BinTypeRow[]
  const bins = await fetchBins(db)

  const usableTypeIds = new Set(binTypes.filter((t) => binTypeIsUsable(t)).map((t) => t.id))
  const activeBins = bins.filter((b) => b.status === 'ACTIVE')
  const withKnownCapacity = activeBins.filter((b) => b.bin_type_id && usableTypeIds.has(b.bin_type_id)).length
  const binCountByType = new Map<string, number>()
  for (const bin of bins) {
    if (!bin.bin_type_id) continue
    binCountByType.set(bin.bin_type_id, (binCountByType.get(bin.bin_type_id) ?? 0) + 1)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-10">
        <div className="mb-6">
          <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">
            ← Back to Dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">Bin Capacity</h1>
          <p className="mt-1 text-sm text-gray-500">
            How big each bin is, in <strong className="font-semibold text-gray-700">inches and pounds</strong> — the
            other half of working out how much stock fits where. Erply has the bins but no field for their size.
          </p>
        </div>

        <div className="mb-6 flex flex-wrap gap-4 text-sm">
          <span className="rounded-lg bg-white border border-gray-200 px-4 py-2 text-gray-700">
            <span className="font-semibold text-gray-900">{activeBins.length.toLocaleString()}</span> active bins
          </span>
          <span className="rounded-lg bg-white border border-gray-200 px-4 py-2 text-gray-700">
            <span className="font-semibold text-gray-900">{withKnownCapacity.toLocaleString()}</span> with known
            capacity
          </span>
          <span className="rounded-lg bg-white border border-gray-200 px-4 py-2 text-gray-700">
            <span className="font-semibold text-gray-900">
              {(activeBins.length - withKnownCapacity).toLocaleString()}
            </span>{' '}
            still unknown
          </span>
          <span className="rounded-lg bg-white border border-gray-200 px-4 py-2 text-gray-700">
            <span className="font-semibold text-gray-900">{binTypes.length.toLocaleString()}</span> bin types
          </span>
        </div>

        {bins.length === 0 && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
            <p className="font-semibold">No bins mirrored in yet.</p>
            <p className="mt-1">
              Run <code>node scripts/seed-bins-from-erply.mjs</code> for a dry run, then{' '}
              <code>--apply</code>. Erply had 518 bins as of 2026-09-14.
            </p>
          </div>
        )}

        <BinCapacityManager
          binTypes={binTypes.map((t) => ({ ...t, binCount: binCountByType.get(t.id) ?? 0 }))}
          bins={bins}
        />

        <p className="mt-6 text-xs text-gray-400">
          Bins are mirrored from Erply and can&apos;t be created or deleted here — re-run{' '}
          <code>scripts/seed-bins-from-erply.mjs</code> after adding bins in Erply. Deleting a bin type leaves its
          bins in place with unknown capacity.
        </p>
      </div>
    </div>
  )
}
