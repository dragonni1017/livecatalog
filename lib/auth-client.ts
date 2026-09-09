import { createBrowserClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

export function getAuthClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// Client used ONLY to request a password-reset email.
//
// @supabase/ssr defaults to PKCE, which keeps the code verifier in browser
// storage on the device that asked for the reset — so the emailed link can
// only be completed in that same browser. Customers routinely open mail in a
// webmail tab, a phone, or an email app's in-app browser, and every one of
// those cases failed with "opened on a different device".
//
// Asking for the recovery mail over the implicit flow instead makes the link
// carry the grant itself (#access_token=… in the fragment), so it completes
// from anywhere. Recovery is already gated by possession of the mailbox; PKCE
// buys nothing here that the single-use, short-lived token doesn't.
//
// Deliberately scoped to this one call — the rest of the app keeps PKCE.
//
// MUST be supabase-js createClient, NOT @supabase/ssr createBrowserClient.
// createBrowserClient sets `flowType: "pkce"` *after* spreading the caller's
// auth options (see its source), so passing flowType there is silently
// discarded and the link stays device-locked. That mistake shipped once.
//
// Nothing here needs a session: this client only posts an email address to
// /auth/v1/recover. Persistence is off so it can't fight the cookie-based
// client above over shared storage.
export function getRecoveryClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        flowType: 'implicit',
        persistSession: false,
        detectSessionInUrl: false,
        autoRefreshToken: false,
      },
    }
  )
}
