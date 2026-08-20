'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { getAuthClient } from '@/lib/auth-client'
import { TIER_COOKIE, TIER_CHANGE_EVENT, type PriceTier } from '@/lib/rep-tier-shared'

function readTierCookie(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${TIER_COOKIE}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

// Rendered unconditionally by the catalog layout (see
// app/(catalog)/layout.tsx) and checks the session itself, client-side —
// same pattern as AccountNav — rather than the layout checking server-side.
// A server-side check would read cookies()/headers() in a Server Component
// that wraps every catalog page, forcing all of them out of ISR/static
// rendering for every visitor, not just reps. This way anonymous-shopper
// traffic (the vast majority) keeps its cached pages untouched.
export default function TierSwitcher({ tiers }: { tiers: PriceTier[] }) {
  const [repEmail, setRepEmail] = useState<string | null>(null)
  const [current, setCurrent] = useState<string | null>(null)

  useEffect(() => {
    const supabase = getAuthClient()
    supabase.auth.getSession().then(({ data }) => {
      const isRep = data.session?.user.app_metadata?.role === 'rep'
      setRepEmail(isRep ? (data.session!.user.email ?? '') : null)
    })
    // One-time hydration from an external store (cookies can't be read on
    // the server), not a reactive setState loop — same pattern as
    // lib/cart-context.tsx's initial localStorage read.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCurrent(readTierCookie())
  }, [])

  if (!repEmail) return null

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const code = e.target.value
    document.cookie = `${TIER_COOKIE}=${code}; path=/; max-age=${60 * 60 * 24 * 30}`
    setCurrent(code)
    window.dispatchEvent(new Event(TIER_CHANGE_EVENT))
  }

  return (
    <div className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5">
      <span className="hidden text-xs font-medium text-amber-800 sm:inline">Rep pricing:</span>
      <select
        value={current ?? ''}
        onChange={handleChange}
        className="rounded border border-amber-300 bg-white px-1.5 py-1 text-xs font-medium text-amber-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
      >
        <option value="" disabled>
          Select tier…
        </option>
        {tiers.map((t) => (
          <option key={t.code} value={t.code}>
            {t.label}
            {t.discount_percent > 0 ? ` (${t.discount_percent}% off)` : ''}
          </option>
        ))}
      </select>
      <Link
        href="/rep"
        className="hidden text-xs text-amber-700 hover:text-amber-900 underline sm:inline"
        title="Rep account"
      >
        {repEmail}
      </Link>
    </div>
  )
}
