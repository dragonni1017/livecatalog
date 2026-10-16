import Link from 'next/link'
import { resolveCdnImage } from '@/lib/image'
import type { StripCard } from '@/lib/collections'

// Homepage row of live collections (lib/collections.ts loadCollectionStrip).
// A cover image if the collection has one, otherwise a 2×2 mosaic of its
// first product photos. Scrolls sideways on small screens.

function Cover({ card }: { card: StripCard }) {
  if (card.cover) {
    return (
      // Plain <img> like ProductCard: stored URLs are raw originals, sized here.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={resolveCdnImage(card.cover, 600) ?? card.cover} alt="" loading="lazy" className="h-full w-full object-cover" />
    )
  }
  const tiles = card.mosaic.slice(0, 4)
  if (tiles.length === 0) {
    return <div className="flex h-full w-full items-center justify-center bg-red-50 text-3xl font-bold text-red-300">{card.name.charAt(0)}</div>
  }
  return (
    <div className={`grid h-full w-full gap-0.5 bg-gray-100 ${tiles.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
      {tiles.map((src, i) => (
        <div key={i} className="flex items-center justify-center overflow-hidden bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={resolveCdnImage(src, 200) ?? src} alt="" loading="lazy" className="max-h-full max-w-full object-contain" />
        </div>
      ))}
    </div>
  )
}

export default function CollectionStrip({ cards }: { cards: StripCard[] }) {
  if (cards.length === 0) return null
  return (
    <section aria-label="Collections" className="mb-6" data-collection-strip>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Shop collections</h2>
      <div className="-mx-1 flex snap-x gap-4 overflow-x-auto px-1 pb-2">
        {cards.map((card) => (
          <Link
            key={card.slug}
            href={`/collections/${card.slug}`}
            className="group w-44 shrink-0 snap-start overflow-hidden rounded-xl border border-gray-200 bg-white transition-shadow hover:border-red-300 hover:shadow-md sm:w-52"
            data-collection-card={card.slug}
          >
            <div className="aspect-[4/3] overflow-hidden">
              <Cover card={card} />
            </div>
            <div className="px-3 py-2">
              <p className="truncate text-sm font-semibold text-gray-900 group-hover:text-red-600">{card.name}</p>
              <p className="text-xs text-gray-500">
                {card.productCount} {card.productCount === 1 ? 'product' : 'products'}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}
