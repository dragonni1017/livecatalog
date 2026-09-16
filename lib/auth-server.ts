import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { User } from '@supabase/supabase-js'

export async function getServerAuthClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a server component — cookies can't be set (no-op is fine)
          }
        },
      },
    }
  )
}

export async function getSessionUser(): Promise<User | null> {
  const supabase = await getServerAuthClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

/**
 * Who to record as having performed an action, for an audit trail or a
 * *_by column. Never throws: attribution is metadata, and a route that
 * already passed the middleware's admin gate should not fail outright
 * because the session lookup did.
 *
 * Do NOT use this where the identity is a security decision — the self-target
 * guards in app/admin/api/accounts stay on getSessionUser, where a failure
 * must not silently become "some admin".
 */
export async function getActorEmail(fallback = 'admin'): Promise<string> {
  try {
    const user = await getSessionUser()
    return user?.email ?? fallback
  } catch {
    return fallback
  }
}
