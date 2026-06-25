'use client'

import { useEffect } from 'react'

// Persists a ?rep=<name> URL param to localStorage so a per-rep catalog link
// (e.g. /?rep=maria) carries the rep through to checkout, where the cart
// prefills "Placed by (rep)". Renders nothing. Uses window.location directly to
// avoid a Suspense boundary for useSearchParams.
export default function RepCapture() {
  useEffect(() => {
    try {
      const rep = new URLSearchParams(window.location.search).get('rep')
      if (rep && rep.trim()) window.localStorage.setItem('livecatalog_rep', rep.trim())
    } catch {
      /* no-op */
    }
  }, [])

  return null
}
