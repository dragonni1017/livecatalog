import Link from 'next/link'
import { Product } from '@/lib/types'
import { cdnImage } from '@/lib/image'
import { extractPackSpec, extractUnitsPerCase } from '@/lib/pack'
import { getDisplaySettings } from '@/lib/display-settings'
import StockBadge from './StockBadge'
import AddToCartButton from './AddToCartButton'
import FavoriteButton from './FavoriteButton'

function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}

interface ProductCardProps {
  product: Product
}

export default async function ProductCard({ product }: ProductCardProps) {
  const packSpec = extractPackSpec(product.name)
  const unitsPerCase = extractUnitsPerCase(product.name)
  const settings = await getDisplaySettings()
  const favoriteItem = {
    id: product.id,
    sku: product.sku,
    name: product.name,
    price_cents: product.price_cents,
    image_url: product.image_url,
    category: product.category?.name ?? '',
  }
  return (
    <div className="relative group flex flex-col rounded-lg border border-gray-200 bg-white overflow-hidden hover:shadow-md transition-shadow duration-200">
      <FavoriteButton item={favoriteItem} />
      <Link
        href={`/product/${product.id}`}
        className="flex flex-col flex-1"
      >
      {/* Image area */}
      <div className="aspect-square w-full bg-gray-100 flex items-center justify-center">
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cdnImage(product.image_url, 400) ?? undefined}
            alt={product.name}
            className="h-full w-full object-contain p-2"
            loading="lazy"
          />
        ) : (
          <div className="flex flex-col items-center gap-1 text-gray-400">
            <svg
              className="h-10 w-10"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 9.75h.008v.008H3V9.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
              />
            </svg>
            <span className="text-xs">No Image</span>
          </div>
        )}
      </div>

      {/* Card body */}
      <div className="flex flex-1 flex-col gap-2 p-3 sm:p-4">
        {product.category && settings.show_category_listing && (
          <span className="text-xs font-medium uppercase tracking-wide text-red-600">
            {product.category.name}
          </span>
        )}
        <h3 className="text-sm font-semibold text-gray-900 leading-snug group-hover:text-red-600 transition-colors">
          {product.name}
        </h3>
        {settings.show_sku_barcode_listing && (
          <>
            <p className="text-xs text-gray-400 font-mono">{product.sku}</p>
            {product.barcode && (
              <p className="hidden sm:block text-xs text-gray-400 font-mono">{product.barcode}</p>
            )}
          </>
        )}
        {packSpec && settings.show_pack_info_listing && (
          <p className="text-xs font-medium text-gray-600">{packSpec}</p>
        )}
        <div className="mt-auto flex items-center justify-between pt-2">
          <div>
            <span className="text-base font-bold text-gray-900">
              {formatPrice(product.price_cents)}
            </span>
          </div>
          {settings.show_stock_listing && <StockBadge qty={product.stock_qty} />}
        </div>
        <div className="pt-1">
          <AddToCartButton
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
        </div>
      </div>
      </Link>
    </div>
  )
}
