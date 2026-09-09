import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const VERIFIABLE_OTP_TYPES = ['email', 'magiclink', 'signup', 'invite', 'email_change'] as const

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type')
  const next = searchParams.get('next') ?? '/account'

  // Recovery links minted before the reset flow moved to /reset-password still
  // point here. Forward them rather than dead-ending — the client page knows
  // every grant shape and can prompt for the new password.
  if (type === 'recovery') {
    const forwarded = new URL('/reset-password', origin)
    for (const key of ['code', 'token_hash', 'type'] as const) {
      const value = searchParams.get(key)
      if (value) forwarded.searchParams.set(key, value)
    }
    return NextResponse.redirect(forwarded)
  }

  if (code || tokenHash) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          },
        },
      }
    )

    // token_hash links carry the grant itself, so they work from any device;
    // a PKCE code needs the verifier cookie this browser stored when the link
    // was requested.
    // `type` is unauthenticated query input, and EmailOtpType widens to
    // `string & {}` upstream — so a cast would let anything through. Check it
    // against the shapes this callback is actually meant to complete instead.
    // 'recovery' is absent on purpose: it's redirected to /reset-password above.
    const otpType = VERIFIABLE_OTP_TYPES.find((t) => t === type) ?? 'email'

    const { error } = tokenHash
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type: otpType })
      : await supabase.auth.exchangeCodeForSession(code!)

    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
    if (/verifier/i.test(error.message)) {
      return NextResponse.redirect(`${origin}/login?error=no_verifier`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_error`)
}
