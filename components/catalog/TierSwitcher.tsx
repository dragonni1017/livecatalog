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
    function checkSession() {
      const supabase = getAuthClient()
      supabase.auth.getSession().then(({ data }) => {
        const isRep = data.session?.user.app_metadata?.role === 'rep'
        setRepEmail(isRep ? (data.session!.user.email ?? '') : null)
        setCurrent(readTierCookie())
        if (!isRep) {
          // Belt-and-suspenders: the logout route already clears this
          // cookie server-side, but if this component is still mounted
          // from before sign-out (see the pageshow listener below), clear
          // it here too so useTierDiscount() stops applying a stale tier
          // to prices immediately rather than waiting on its own re-sync.
          document.cookie = `${TIER_COOKIE}=; path=/; max-age=0`
          window.dispatchEvent(new Event(TIER_CHANGE_EVENT))
        }
      })
    }
    checkSession()
    // Next.js's App Router persists a shared layout's component tree across
    // client-side and back/forward navigation instead of remounting it, so
    // a plain mount-only effect never re-checks the session after sign-out
    // if this component survives that navigation. `pageshow` fires on a
    // fresh load *and* on a bfcache restore (e.g. pressing Back after
    // logging out), which a mount effect alone would miss.
    window.addEventListener('pageshow', checkSession)
    return () => window.removeEventListener('pageshow', checkSession)
  }, [])

  if (!repEmail) return null

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const code = e.target.value
    document.cookie = `${TIER_COOKIE}=${code}; path=/; max-age=${60 * 60 * 24 * 30}`
    setCurrent(code)
    window.dispatchEvent(new Event(TIER_CHANGE_EVENT))
  }

  return (
    <div
      className="flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-1"
      title="Rep pricing"
    >
      <select
        value={current ?? ''}
        onChange={handleChange}
        className="w-24 rounded border border-amber-300 bg-white px-1 py-0.5 text-xs font-medium text-amber-900 focus:outline-none focus:ring-1 focus:ring-amber-500"
      >
        <option value="" disabled>
          Tier…
        </option>
        {tiers.map((t) => (
          <option key={t.code} value={t.code}>
            {t.label}
          </option>
        ))}
      </select>
      <Link
        href="/rep"
        className="hidden text-[10px] text-amber-700 hover:text-amber-900 underline lg:inline"
        title="Rep account"
      >
        {repEmail}
      </Link>
    </div>
  )
}
