'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Session } from '@supabase/supabase-js'
import { getAuthClient } from '@/lib/auth-client'

export default function AccountNav() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    const supabase = getAuthClient()

    // Get initial session
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
    })

    // Subscribe to auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  // Avoid flash — render nothing until session state is known
  if (session === undefined) return null

  if (session) {
    return (
      <Link
        href="/account"
        className="text-xs font-medium text-gray-600 hover:text-red-600"
      >
        Account
      </Link>
    )
  }

  return (
    <Link
      href="/login"
      className="text-xs font-medium text-gray-600 hover:text-red-600"
    >
      Login
    </Link>
  )
}
