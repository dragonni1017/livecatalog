'use client'

import { useEffect } from 'react'
import { track } from '@/lib/track'

// Fire-and-forget product-view tracking. Renders nothing. Deduped per browser
// session so a refresh/re-mount of the same product doesn't double-count.
//
// A visit from a printed line-card QR code arrives as ?src=qr (lib/qr.ts):
// the view is tagged source 'qr' and the marker is then removed from the
// address bar, so a link copied or shared from here doesn't count as a scan.
export default function TrackView({ productId }: { productId: string }) {
  useEffect(() => {
    let fromQr = false
    try {
      const url = new URL(window.location.href)
      if (url.searchParams.get('src') === 'qr') {
        fromQr = true
        url.searchParams.delete('src')
        window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash)
      }
    } catch {
      // URL/history unavailable: track as a plain view.
    }

    // A scan counts even if this product was already viewed this session, and
    // it IS this visit's view: marking the plain key too stops a second
    // untagged view right after (the effect re-running on the now-clean URL,
    // e.g. React's dev double-invoke, or any remount).
    const viewKey = `tracked_view:${productId}`
    const key = fromQr ? `tracked_view_qr:${productId}` : viewKey
    try {
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
      if (fromQr) sessionStorage.setItem(viewKey, '1')
    } catch {
      // sessionStorage unavailable — still track, just without dedupe.
    }
    track(fromQr ? { type: 'view', productId, source: 'qr' } : { type: 'view', productId })
  }, [productId])

  return null
}
