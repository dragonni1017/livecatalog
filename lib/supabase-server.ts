import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Cookie-aware Supabase client for Route Handlers (and Server Components, read-only
// there). Reads/writes the same auth cookies the browser client sets on sign-in, so
// `supabase.auth.getUser()` reflects whichever staff member is signed in.
//
// Use this — not the plain `supabase` export in lib/supabase.ts — anywhere you need
// to know *who* is making a request (e.g. attributing a stock adjustment). For
// data reads/writes that don't need a specific user, keep using getAdminClient().
export async function getServerSupabaseClient() {
  const cookieStore = await cookies()
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // Called from a Server Component, which can't set cookies — fine,
          // middleware refreshes the session cookie on every request anyway.
        }
      },
    },
  })
}
