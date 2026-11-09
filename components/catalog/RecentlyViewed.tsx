'use client'

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { resolveCdnImage } from '@/lib/image'
import { parseRecent, RECENT_KEY, rememberRecent, type RecentItem } from '@/lib/recently-viewed'

// localStorage as an external store: the server (and first paint) sees an
// empty list, then the browser's; other tabs' changes arrive via 'storage'.
function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange)
  return () => window.removeEventListener('storage', onChange)
}
function getSnapshot(): string {
  try {
    return localStorage.getItem(RECENT_KEY) ?? '[]'
  } catch {
    return '[]'
  }
}
const getServerSnapshot = () => '[]'

/** Product page: remember this product. Renders nothing. */
export function RememberViewed({ item }: { item: RecentItem }) {
  useEffect(() => {
    rememberRecent(item)
  }, [item])
  return null
}

/**
 * A strip of the visitor's recently viewed products (lib/recently-viewed.ts),
 * read from the browser after hydration (empty on the server). Hidden until there's
 * at least one product other than the current one.
 */
export default function RecentlyViewed({ excludeId, max = 6 }: { excludeId?: string; max?: number }) {
  const stored = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const items = useMemo(() => parseRecent(stored).filter((x) => x.id !== excludeId).slice(0, max), [stored, excludeId, max])
  if (items.length === 0) return null

  return (
    <section aria-label="Recently viewed" className="mt-10">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Recently viewed</h2>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {items.map((p) => {
          const img = resolveCdnImage(p.image_url, 200)
          return (
            <Link
              key={p.id}
              href={`/product/${p.id}`}
              className="group w-32 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-white hover:border-red-300"
            >
              <div className="aspect-square bg-gray-100">
                {img && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt="" loading="lazy" className="h-full w-full object-contain p-1.5" />
                )}
              </div>
              <p className="line-clamp-2 px-2 py-1.5 text-xs text-gray-700 group-hover:text-red-600">{p.name}</p>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
