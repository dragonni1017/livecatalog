'use client'

import { useEffect } from 'react'
import { track } from '@/lib/track'

// Fire-and-forget product-view tracking. Renders nothing. Deduped per browser
// session so a refresh/re-mount of the same product doesn't double-count.
export default function TrackView({ productId }: { productId: string }) {
  useEffect(() => {
    const key = `tracked_view:${productId}`
    try {
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
    } catch {
      // sessionStorage unavailable — still track, just without dedupe.
    }
    track({ type: 'view', productId })
  }, [productId])

  return null
}
