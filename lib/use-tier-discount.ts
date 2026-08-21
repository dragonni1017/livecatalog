'use client'

import { useEffect, useState } from 'react'
import { TIER_COOKIE, TIER_CHANGE_EVENT, type PriceTier } from '@/lib/rep-tier-shared'

function readTierCookie(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${TIER_COOKIE}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

// Reads the rep-selected tier from the client-side cookie and resolves it
// against the given active tiers list, re-syncing whenever TierSwitcher
// changes the selection. Returns 0 (no discount) for every visitor who
// isn't a rep with a tier selected. Display-only — app/api/orders/route.ts
// independently re-verifies the real session + tier at submit time.
export function useTierDiscount(tiers: PriceTier[]): number {
  const [discountPercent, setDiscountPercent] = useState(0)

  useEffect(() => {
    function sync() {
      const code = readTierCookie()
      const tier = code ? tiers.find((t) => t.code === code) : undefined
      setDiscountPercent(tier ? Number(tier.discount_percent) : 0)
    }
    sync()
    window.addEventListener(TIER_CHANGE_EVENT, sync)
    // Also re-sync on pageshow (fires on bfcache restores, e.g. pressing
    // Back after signing out) — this hook has no session check of its own
    // (see the comment above), so it depends entirely on the cookie being
    // current. A mount-only effect would keep serving whatever
    // discountPercent it computed before a bfcache restore even after the
    // cookie was cleared server-side on logout.
    window.addEventListener('pageshow', sync)
    return () => {
      window.removeEventListener(TIER_CHANGE_EVENT, sync)
      window.removeEventListener('pageshow', sync)
    }
  }, [tiers])

  return discountPercent
}
