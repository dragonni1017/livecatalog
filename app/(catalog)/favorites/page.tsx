'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useFavorites, type FavoriteItem } from '@/lib/favorites-context'
import FavoriteButton from '@/components/catalog/FavoriteButton'
import { cdnImage } from '@/lib/image'

export const dynamic = 'force-dynamic'

function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`
}

function FavoriteCard({ item }: { item: FavoriteItem }) {
  return (
    <div className="relative flex flex-col rounded-lg border border-gray-200 bg-white overflow-hidden hover:shadow-md transition-shadow duration-200">
      <FavoriteButton item={item} />
      <Link href={`/product/${item.id}`} className="flex flex-col flex-1">
        {/* Image */}
        <div className="aspect-square w-full bg-gray-100 flex items-center justify-center">
          {item.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={cdnImage(item.image_url, 400) ?? undefined}
              alt={item.name}
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
        <div className="flex flex-1 flex-col gap-1.5 p-4">
          {item.category && (
            <span className="text-xs font-medium uppercase tracking-wide text-red-600">
              {item.category}
            </span>
          )}
          <h3 className="text-sm font-semibold text-gray-900 leading-snug hover:text-red-600 transition-colors">
            {item.name}
          </h3>
          <p className="text-xs text-gray-400 font-mono">{item.sku}</p>
          <div className="mt-auto pt-2">
            <span className="text-base font-bold text-gray-900">
              {formatPrice(item.price_cents)}
            </span>
          </div>
          <span className="mt-1 block w-full rounded-md bg-red-600 px-3 py-1.5 text-center text-xs font-semibold text-white hover:bg-red-700 transition-colors">
            View &amp; Add to Cart
          </span>
        </div>
      </Link>
    </div>
  )
}

export default function FavoritesPage() {
  const [mounted, setMounted] = useState(false)
  const { favorites } = useFavorites()

  // One-time mount flag: favorites come from localStorage via context, which
  // can't be read on the server, so we defer rendering them until after mount.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  return (
    <div className="mx-auto max-w-5xl">
      {/* Back link */}
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

      <h1 className="mb-6 text-2xl font-bold text-gray-900">Saved Items</h1>

      {/* SSR-safe render gate */}
      {!mounted ? (
        /* Skeleton placeholder while hydrating */
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="rounded-lg border border-gray-200 bg-white">
              <div className="aspect-square w-full animate-pulse bg-gray-100" />
              <div className="p-4 space-y-2">
                <div className="h-3 w-2/3 animate-pulse rounded bg-gray-100" />
                <div className="h-4 w-full animate-pulse rounded bg-gray-100" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-gray-100" />
              </div>
            </div>
          ))}
        </div>
      ) : favorites.length === 0 ? (
        /* Empty state */
        <div className="flex flex-col items-center justify-center gap-4 py-24 text-center">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1}
            stroke="currentColor"
            className="h-16 w-16 text-gray-300"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z"
            />
          </svg>
          <p className="text-lg font-semibold text-gray-500">No saved items yet.</p>
          <Link
            href="/"
            className="text-sm font-medium text-red-600 hover:text-red-700"
          >
            Browse the catalog &rarr;
          </Link>
        </div>
      ) : (
        /* Favorites grid */
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {favorites.map((item) => (
            <FavoriteCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  )
}
