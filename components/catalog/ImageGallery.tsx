'use client'

import { useState } from 'react'

interface Props {
  primaryUrl: string | null
  additionalUrls: string[]
  productName: string
}

const PLACEHOLDER_CLASS = 'flex flex-col items-center justify-center gap-2 text-gray-400 h-full w-full'

function PlaceholderIcon() {
  return (
    <svg className="h-16 w-16" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1}
        d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 9.75h.008v.008H3V9.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
      />
    </svg>
  )
}

export default function ImageGallery({ primaryUrl, additionalUrls, productName }: Props) {
  const allImages = [primaryUrl, ...additionalUrls].filter(Boolean) as string[]
  const [activeIndex, setActiveIndex] = useState(0)
  const [brokenIndices, setBrokenIndices] = useState<Set<number>>(new Set())

  const activeUrl = allImages[activeIndex] ?? null
  const isBroken = brokenIndices.has(activeIndex)
  const showThumbs = allImages.length > 1

  function markBroken(index: number) {
    setBrokenIndices((prev) => new Set(prev).add(index))
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Main image */}
      <div className="aspect-square rounded-xl bg-gray-50 flex items-center justify-center overflow-hidden">
        {activeUrl && !isBroken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={activeUrl}
            alt={productName}
            className="h-full w-full object-contain p-4"
            onError={() => markBroken(activeIndex)}
          />
        ) : (
          <div className={PLACEHOLDER_CLASS}>
            <PlaceholderIcon />
            <span className="text-sm">No Image Available</span>
          </div>
        )}
      </div>

      {/* Thumbnail strip */}
      {showThumbs && (
        <div className="flex gap-2 flex-wrap">
          {allImages.map((url, i) => {
            const isActive = i === activeIndex
            const isThumbnailBroken = brokenIndices.has(i)
            return (
              <button
                key={i}
                type="button"
                onClick={() => setActiveIndex(i)}
                className={`h-14 w-14 shrink-0 rounded-lg overflow-hidden bg-gray-100 border-2 transition-all ${
                  isActive ? 'border-red-500 ring-2 ring-red-300' : 'border-transparent hover:border-gray-300'
                }`}
                aria-label={`View image ${i + 1}`}
              >
                {!isThumbnailBroken ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={url}
                    alt={`${productName} image ${i + 1}`}
                    className="h-full w-full object-contain"
                    onError={() => markBroken(i)}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <svg className="h-6 w-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3 9.75h.008v.008H3V9.75zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                    </svg>
                  </div>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
