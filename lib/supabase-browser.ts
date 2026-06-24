import { createBrowserClient } from '@supabase/ssr'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

// Browser-side Supabase client for the staff login page (and sign-out button).
// Stores the session in cookies (not localStorage) so the server — middleware
// and route handlers — sees the same signed-in session via lib/supabase-server.ts.
export function getBrowserSupabaseClient() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey)
}
