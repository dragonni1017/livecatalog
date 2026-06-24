import { notFound } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Product } from '@/lib/types'
import { cdnImage } from '@/lib/image'
import StockBadge from '@/components/catalog/StockBadge'
import Barcode from '@/components/catalog/Barcode'
import AddToCartButton from '@/components/catalog/AddToCartButton'
import ProductCard from '@/components/catalog/ProductCard'
import TrackView from '@/components/catalog/TrackView'

export const dynamic = 'force-dynamic'

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

interface ProductPageProps {
  params: Promise<{ id: string }>
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { id } = await params
  const { data: product } = await supabase
    .from('products')
    .select('*, category:categories(*)')
    .eq('id', id)
    .eq('manually_hidden', false)
    .single()

  if (!product) notFound()

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
          {/* Image */}
          <div className="aspect-square bg-gray-100 flex items-center justify-center">
            {product.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={cdnImage(product.image_url, 800) ?? undefined}
                alt={product.name}
                className="h-full w-full object-contain p-4"
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-gray-400">
                <svg className="h-16 w-16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 9.75h.008v.008H3V9.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                </svg>
                <span className="text-sm">No Image Available</span>
              </div>
            )}
          </div>

          {/* Details */}
          <div className="flex flex-col gap-4 p-8">
            {product.category && (
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

            <p className="text-xs text-gray-400 font-mono">SKU: {product.sku}</p>

            {product.barcode && <Barcode value={product.barcode} />}

            <p className="text-3xl font-bold text-gray-900">{formatPrice(product.price_cents)}</p>

            <div>
              <StockBadge qty={product.stock_qty} />
              {product.stock_qty > 0 && (
                <span className="ml-2 text-xs text-gray-500">{product.stock_qty} units available</span>
              )}
            </div>

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
            />

            <div className="border-t border-gray-100" />

            {product.description && (
              <div>
                <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                  Description
                </h2>
                <p className="text-sm text-gray-700 leading-relaxed">{product.description}</p>
              </div>
            )}
          </div>
        </div>
      </div>

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
