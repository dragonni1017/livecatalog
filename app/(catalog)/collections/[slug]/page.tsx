import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { supabase, getAdminClient } from '@/lib/supabase'
import { COLLECTION_FIELDS, isLive, loadCollectionProductIds, loadLiveCollections, type Collection } from '@/lib/collections'
import ProductCard from '@/components/catalog/ProductCard'
import CategoryNav from '@/components/catalog/CategoryNav'
import { Product } from '@/lib/types'

export const dynamic = 'force-dynamic'

// A curated / seasonal collection (lib/collections.ts). collections and
// collection_products are server-read only (RLS, no public policy), like
// shipments for /new-arrivals: only product ids leave that step, and the
// products themselves come from the public client with the usual visibility
// filters. A collection that isn't live (off, or outside its dates) is a 404.

async function loadLiveCollection(slug: string): Promise<Collection | null> {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return null
  const { data } = await getAdminClient().from('collections').select(COLLECTION_FIELDS).eq('slug', slug).maybeSingle()
  const c = data as Collection | null
  return c && isLive(c) ? c : null
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const c = await loadLiveCollection((await params).slug)
  if (!c) return { title: 'Collection not found' }
  return { title: c.name, description: c.description ?? `${c.name} — wholesale from L&Y USA` }
}

export default async function CollectionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const collection = await loadLiveCollection(slug)
  if (!collection) notFound()

  const db = getAdminClient()
  const ids = await loadCollectionProductIds(db, collection.id)

  const [{ data: categories }, collections, { data }] = await Promise.all([
    supabase.from('categories').select('*').order('display_order'),
    loadLiveCollections(db),
    ids.length
      ? supabase
          .from('products')
          .select(
            'id, sku, barcode, name, description, price_cents, category_id, image_url, stock_qty, is_active, manually_hidden, created_at, updated_at, category:categories!products_category_id_fkey(id, name, slug, display_order)',
          )
          .eq('is_active', true)
          .eq('manually_hidden', false)
          .in('id', ids)
      : Promise.resolve({ data: [] }),
  ])

  // Keep the admin's chosen order; hidden/inactive products simply drop out.
  const rank = new Map(ids.map((id, i) => [id, i]))
  const products = ((data ?? []) as unknown as Product[]).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
      <aside className="lg:w-48 lg:shrink-0">
        <div className="lg:sticky lg:top-24">
          <p className="mb-3 hidden text-xs font-semibold uppercase tracking-wider text-gray-500 lg:block">
            Categories
          </p>
          <Suspense fallback={<div className="h-9 w-full rounded-md bg-gray-100 animate-pulse" />}>
            <CategoryNav categories={categories ?? []} collections={collections} />
          </Suspense>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{collection.name}</h1>
          {collection.description && <p className="mt-1 max-w-2xl text-sm text-gray-500">{collection.description}</p>}
        </div>

        {products.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white py-16 text-center">
            <p className="text-sm text-gray-500">No products in this collection right now.</p>
          </div>
        ) : (
          <>
            <div className="mb-4">
              <p className="text-sm text-gray-500">
                {products.length.toLocaleString()} {products.length === 1 ? 'product' : 'products'}
              </p>
            </div>
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {products.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
