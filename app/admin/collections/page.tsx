import Link from 'next/link'
import { getAdminClient } from '@/lib/supabase'
import { COLLECTION_FIELDS, notLiveReason, todayPacific, type Collection } from '@/lib/collections'
import { CollectionDetailsForm } from './CollectionEditor'

export const dynamic = 'force-dynamic'

// Curated / seasonal collections (migration 0059).
export default async function AdminCollectionsPage() {
  const db = getAdminClient()
  const [{ data, error }, { data: links }] = await Promise.all([
    db.from('collections').select(COLLECTION_FIELDS).order('display_order').order('name'),
    db.from('collection_products').select('collection_id'),
  ])
  const collections = (data ?? []) as Collection[]
  const counts = new Map<string, number>()
  for (const l of (links ?? []) as { collection_id: string }[]) counts.set(l.collection_id, (counts.get(l.collection_id) ?? 0) + 1)
  const today = todayPacific()

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6">
        <Link href="/admin" className="text-sm text-red-600 hover:text-red-700">← Admin</Link>
        <h1 className="mt-1 text-2xl font-bold text-gray-900">Collections</h1>
        <p className="mt-1 text-sm text-gray-500">
          Curated product groups (&quot;Valentine&apos;s&quot;, &quot;Graduation&quot;) with their own page. Live collections appear
          in the catalog menu next to New Arrivals.
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Couldn&apos;t load collections. If this is a new install, run{' '}
          <code className="font-mono">supabase/migrations/0059_collections.sql</code>.
        </p>
      ) : (
        <div className="mb-8 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {collections.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-gray-500">No collections yet. Create one below.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {collections.map((c) => {
                const reason = notLiveReason(c, today)
                return (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <Link href={`/admin/collections/${c.id}`} className="font-medium text-gray-900 hover:text-red-600">
                        {c.name}
                      </Link>
                      <p className="text-xs text-gray-500">
                        /collections/{c.slug} · {counts.get(c.id) ?? 0} products
                        {c.starts_on || c.ends_on ? ` · ${c.starts_on ?? '…'} to ${c.ends_on ?? '…'}` : ''}
                      </p>
                    </div>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${reason ? 'bg-gray-100 text-gray-600' : 'bg-green-100 text-green-700'}`}>
                      {reason ?? 'Live'}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">New collection</h2>
        <CollectionDetailsForm />
      </section>
    </div>
  )
}
