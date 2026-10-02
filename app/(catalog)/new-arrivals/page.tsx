import { Suspense } from 'react'
import { supabase, getAdminClient } from '@/lib/supabase'
import { latestArrivalBySku, NEW_ARRIVAL_DAYS, newArrivalsSinceMs, type ShipmentLineRow, type ShipmentRow } from '@/lib/new-arrivals'
import ProductCard from '@/components/catalog/ProductCard'
import CategoryNav from '@/components/catalog/CategoryNav'
import { Product } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Arrival dates come from receiving, not products.created_at (which is the
// import date). See lib/new-arrivals.ts.
export default async function NewArrivalsPage() {
  const sinceMs = newArrivalsSinceMs()

  // shipments / shipment_lines are service-role only (RLS, no public policy),
  // so they're read with the admin client here on the server. Only SKUs
  // leave this step; the products themselves come from the public client
  // with the usual visibility filters.
  const db = getAdminClient()
  const { data: shipments } = await db
    .from('shipments')
    .select('id, status, applied_at')
    .eq('status', 'applied')
    .gte('applied_at', new Date(sinceMs).toISOString())
  const shipmentIds = (shipments ?? []).map((s) => s.id as string)
  const { data: lines } = shipmentIds.length
    ? await db.from('shipment_lines').select('shipment_id, sku, qty_received').in('shipment_id', shipmentIds)
    : { data: [] }
  const arrivedAt = latestArrivalBySku((shipments ?? []) as ShipmentRow[], (lines ?? []) as ShipmentLineRow[], sinceMs)
  const skus = [...arrivedAt.keys()].slice(0, 500)

  const [{ data: categories }, { data }] = await Promise.all([
    supabase.from('categories').select('*').order('display_order'),
    skus.length
      ? supabase
          .from('products')
          .select(
            'id, sku, barcode, name, description, price_cents, category_id, image_url, stock_qty, is_active, manually_hidden, created_at, updated_at, category:categories!products_category_id_fkey(id, name, slug, display_order)',
          )
          .eq('is_active', true)
          .eq('manually_hidden', false)
          .in('sku', skus)
      : Promise.resolve({ data: [] }),
  ])

  // Most recent arrival first, then by name within one delivery.
  const products = ((data ?? []) as unknown as Product[]).sort(
    (a, b) =>
      Date.parse(arrivedAt.get(b.sku) ?? '') - Date.parse(arrivedAt.get(a.sku) ?? '') ||
      a.name.localeCompare(b.name),
  )

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
      <aside className="lg:w-48 lg:shrink-0">
        <div className="lg:sticky lg:top-24">
          <p className="mb-3 hidden text-xs font-semibold uppercase tracking-wider text-gray-500 lg:block">
            Categories
          </p>
          <Suspense fallback={
            <>
              <div className="flex gap-2 overflow-x-auto pb-1 lg:hidden">
                {[56, 44, 80, 72, 64, 60, 76].map((w, i) => (
                  <div key={i} className="h-8 shrink-0 rounded-full bg-gray-200 animate-pulse" style={{ width: `${w}px` }} />
                ))}
              </div>
              <div className="hidden lg:flex lg:flex-col lg:gap-1">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-9 w-full rounded-md bg-gray-100 animate-pulse" />
                ))}
              </div>
            </>
          }>
            <CategoryNav categories={categories ?? []} />
          </Suspense>
        </div>
      </aside>

      <div className="flex-1 min-w-0">
        {/* Page heading */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">New Arrivals</h1>
          <p className="mt-1 text-sm text-gray-500">Received in the last {NEW_ARRIVAL_DAYS} days</p>
        </div>

        {products.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white py-16 text-center">
            <p className="text-sm text-gray-500">Nothing new has been received in the last {NEW_ARRIVAL_DAYS} days.</p>
          </div>
        ) : (
          <>
            <div className="mb-4">
              <p className="text-sm text-gray-500">
                {products.length.toLocaleString()}{' '}
                {products.length === 1 ? 'product' : 'products'}
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
