import { cache } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { supabase, getAdminClient } from '@/lib/supabase'
import { Product } from '@/lib/types'
import { resolveCdnImage } from '@/lib/image'
import { extractPackSpec, extractUnitsPerCase } from '@/lib/pack'
import { getDisplaySettings } from '@/lib/display-settings'
import StockBadge from '@/components/catalog/StockBadge'
import Barcode from '@/components/catalog/Barcode'
import AddToCartButton from '@/components/catalog/AddToCartButton'
import ProductCard from '@/components/catalog/ProductCard'
import TrackView from '@/components/catalog/TrackView'
import BackInStockForm from '@/components/catalog/BackInStockForm'
import ImageGallery from '@/components/catalog/ImageGallery'

// Cache the rendered page for 10 minutes (ISR). Product pages don't depend on
// per-request state, so this serves them from cache and only re-queries Supabase
// every 10 min — faster pages, lower DB load. Stock can be up to 10 min stale,
// which is fine for a quote-request catalog.
export const revalidate = 600

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

// React.cache dedupes the lookup so generateMetadata and the page share one query.
const getProduct = cache(async (id: string) => {
  const { data } = await supabase
    .from('products')
    .select('*, category:categories(*)')
    .eq('id', id)
    .eq('manually_hidden', false)
    .single()
  return (data as Product) ?? null
})

interface ProductPageProps {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { id } = await params
  const product = await getProduct(id)
  if (!product) return { title: 'Product not found' }

  const price = formatPrice(product.price_cents)
  const description = (product.description?.trim() || `${product.name} — ${price}. Available from L & Y USA. Request a quote.`).slice(0, 200)
  const img = resolveCdnImage(product.image_url, 1200)

  return {
    title: product.name,
    description,
    openGraph: {
      title: product.name,
      description,
      type: 'website',
      images: img ? [{ url: img, alt: product.name }] : undefined,
    },
  }
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { id } = await params
  const product = await getProduct(id)

  if (!product) notFound()

  const settings = await getDisplaySettings()
  const unitsPerCase = extractUnitsPerCase(product.name)

  // "More in this category" — a few other in-catalog products from the same
  // category, so a product page isn't a dead end.
  let related: Product[] = []
  if (product.category_id) {
    const { data } = await supabase
      .from('products')
      .select('*, category:categories(*)')
      .eq('is_active', true)
      .eq('manually_hidden', false)
      .eq('category_id', product.category_id)
      .neq('id', product.id)
      .order('name')
      .limit(6)
    related = (data ?? []) as Product[]
  }

  // "Customers also ordered" — products most frequently co-purchased with this one.
  // Uses two queries against order_items (RLS = service role only) + a JS count.
  let alsoOrdered: Product[] = []
  const db = getAdminClient()
  const { data: orderRows } = await db
    .from('order_items')
    .select('order_id')
    .eq('product_id', product.id)

  const orderIds = (orderRows ?? []).map((r) => r.order_id)
  if (orderIds.length > 0) {
    const { data: coItems } = await db
      .from('order_items')
      .select('product_id')
      .in('order_id', orderIds)
      .neq('product_id', product.id)
      .not('product_id', 'is', null)

    const counts: Record<string, number> = {}
    for (const row of coItems ?? []) {
      if (row.product_id) counts[row.product_id] = (counts[row.product_id] ?? 0) + 1
    }
    const topIds = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([pid]) => pid)

    if (topIds.length > 0) {
      const { data: coProducts } = await supabase
        .from('products')
        .select('*, category:categories(*)')
        .in('id', topIds)
        .eq('is_active', true)
        .eq('manually_hidden', false)
      const byId = new Map((coProducts ?? []).map((p) => [p.id, p]))
      alsoOrdered = topIds
        .map((pid) => byId.get(pid))
        .filter((p): p is NonNullable<typeof p> => !!p) as Product[]
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <TrackView productId={product.id} />
      <div className="mb-6">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-red-600 hover:text-red-700"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Back to catalog
        </Link>
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2">
          {/* Image gallery */}
          <div className="p-4">
            <ImageGallery
              primaryUrl={product.image_url ? (resolveCdnImage(product.image_url, 800) ?? product.image_url) : null}
              additionalUrls={product.image_urls ?? []}
              productName={product.name}
            />
          </div>

          {/* Details */}
          <div className="flex flex-col gap-4 p-8">
            {product.category && settings.show_category_detail && (
              <nav className="flex items-center gap-1.5 text-xs text-gray-500">
                <Link href="/" className="hover:text-red-600">All Products</Link>
                <span>/</span>
                <Link
                  href={`/?category=${product.category.slug}`}
                  className="font-medium text-red-600 hover:text-red-700"
                >
                  {product.category.name}
                </Link>
              </nav>
            )}

            <h1 className="text-2xl font-bold text-gray-900 leading-snug">{product.name}</h1>

            {settings.show_sku_barcode_detail && (
              <>
                <p className="text-xs text-gray-400 font-mono">SKU: {product.sku}</p>
                {product.barcode && <Barcode value={product.barcode} />}
              </>
            )}

            {settings.show_price_detail && (
              product.volume_tiers && product.volume_tiers.length > 0 ? (
                <div>
                  <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">Volume pricing</p>
                  <table className="w-full text-sm">
                    <tbody>
                      <tr className="border-b border-gray-100">
                        <td className="py-1.5 text-gray-500">1+ units</td>
                        <td className="py-1.5 text-right font-semibold text-gray-900">{formatPrice(product.price_cents)}</td>
                      </tr>
                      {[...product.volume_tiers]
                        .sort((a, b) => a.min_qty - b.min_qty)
                        .map((tier) => (
                          <tr key={tier.min_qty} className="border-b border-gray-100 bg-green-50">
                            <td className="py-1.5 font-medium text-green-800">{tier.min_qty}+ units</td>
                            <td className="py-1.5 text-right font-bold text-green-800">{formatPrice(tier.price_cents)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-3xl font-bold text-gray-900">{formatPrice(product.price_cents)}</p>
              )
            )}

            {settings.show_stock_detail && (
              <div>
                <StockBadge qty={product.stock_qty} />
                {product.stock_qty > 0 && (
                  <span className="ml-2 text-xs text-gray-500">{product.stock_qty} units available</span>
                )}
              </div>
            )}

            {product.stock_qty <= 0 && (
              <BackInStockForm productId={product.id} />
            )}

            <AddToCartButton
              variant="detail"
              product={{
                productId: product.id,
                sku: product.sku,
                name: product.name,
                priceCents: product.price_cents,
                imageUrl: product.image_url,
                stockQty: product.stock_qty,
              }}
              unitsPerCase={unitsPerCase}
            />

            <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm text-blue-800">
              <svg className="mt-0.5 h-4 w-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
              </svg>
              <span>Quote request — no payment is taken online. A rep confirms availability and pricing before invoicing.</span>
            </div>

            <div className="border-t border-gray-100" />

            {(() => {
              const packSpec = extractPackSpec(product.name)
              const showPackInfo = settings.show_pack_info_detail && !!packSpec
              if (!showPackInfo && !product.description) return null
              return (
                <div>
                  {showPackInfo && (
                    <>
                      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                        Pack quantity
                      </h2>
                      <p className="text-sm font-semibold text-gray-900">{packSpec}</p>
                      {unitsPerCase > 0 && (
                        <div className="mt-1">
                          <span className="text-sm text-gray-500">Case size</span>
                          <div className="flex items-baseline gap-2">
                            <span className="text-sm text-gray-900">{unitsPerCase} units</span>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                  {product.description && (
                    <p className="mt-0.5 text-sm leading-relaxed text-gray-600">{product.description}</p>
                  )}
                </div>
              )
            })()}
          </div>
        </div>
      </div>

      {alsoOrdered.length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 text-lg font-bold text-gray-900">Customers also ordered</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {alsoOrdered.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      {related.length > 0 && (
        <section className="mt-10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900">
              More in {product.category?.name ?? 'this category'}
            </h2>
            {product.category && (
              <Link
                href={`/?category=${product.category.slug}`}
                className="text-sm font-medium text-red-600 hover:text-red-700"
              >
                View all →
              </Link>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
