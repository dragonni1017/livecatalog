'use client'

import { useEffect, useState } from 'react'
import { getAuthClient } from './auth-client'

// Whether the current visitor is signed in as a rep (app_metadata.role ===
// 'rep'), re-checked on mount and on pageshow (fires on bfcache restores
// too, e.g. pressing Back after signing out) so this never serves a stale
// answer across a shared layout's persisted component tree -- same pattern
// as components/catalog/TierSwitcher.tsx (kept as its own copy rather than
// refactored to share this hook, since that component's session-check
// timing was the source of a real, carefully-fixed bug earlier and isn't
// worth re-touching for a DRY refactor).
export function useIsRep(): { isRep: boolean; repEmail: string | null } {
  const [isRep, setIsRep] = useState(false)
  const [repEmail, setRepEmail] = useState<string | null>(null)

  useEffect(() => {
    function check() {
      const supabase = getAuthClient()
      supabase.auth.getSession().then(({ data }) => {
        const rep = data.session?.user.app_metadata?.role === 'rep'
        setIsRep(rep)
        setRepEmail(rep ? (data.session!.user.email ?? '') : null)
      })
    }
    check()
    window.addEventListener('pageshow', check)
    return () => window.removeEventListener('pageshow', check)
  }, [])

  return { isRep, repEmail }
}
