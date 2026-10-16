import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAdminClient } from '@/lib/supabase'
import { COLLECTION_FIELDS, loadCollectionProductIds, notLiveReason, type Collection } from '@/lib/collections'
import { CollectionDetailsForm, CollectionProductsForm } from '../CollectionEditor'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function AdminCollectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const db = getAdminClient()
  const { data } = await db.from('collections').select(COLLECTION_FIELDS).eq('id', id).maybeSingle()
  const collection = data as Collection | null
  if (!collection) notFound()

  // Current SKUs in display order.
  const ids = await loadCollectionProductIds(db, id)
  const { data: rows } = ids.length ? await db.from('products').select('id, sku').in('id', ids) : { data: [] }
  const skuById = new Map(((rows ?? []) as { id: string; sku: string }[]).map((r) => [r.id, r.sku]))
  const skus = ids.map((pid) => skuById.get(pid)).filter((s): s is string => !!s)
  const reason = notLiveReason(collection)

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <Link href="/admin/collections" className="text-sm text-red-600 hover:text-red-700">← Collections</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-gray-900">{collection.name}</h1>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${reason ? 'bg-gray-100 text-gray-600' : 'bg-green-100 text-green-700'}`}>
            {reason ?? 'Live'}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap gap-4 text-sm">
          {reason ? (
            <span className="text-gray-400">Page isn&apos;t public until it&apos;s live</span>
          ) : (
            <Link href={`/collections/${collection.slug}`} target="_blank" className="text-red-600 hover:text-red-700">
              View page ↗
            </Link>
          )}
          <Link href={`/admin/line-card?collection=${collection.slug}&title=${encodeURIComponent(collection.name)}`} className="text-red-600 hover:text-red-700">
            Print line card
          </Link>
        </div>
      </div>

      <section className="mb-6 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Details</h2>
        <CollectionDetailsForm initial={collection} />
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Products ({skus.length})</h2>
        <CollectionProductsForm id={collection.id} initialSkus={skus} />
      </section>
    </div>
  )
}
