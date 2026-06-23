'use client'

import { useEffect } from 'react'

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
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'view', productId }),
      keepalive: true,
    }).catch(() => {})
  }, [productId])

  return null
}
