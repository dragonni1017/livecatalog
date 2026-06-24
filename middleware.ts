import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Protects /admin/* with real staff logins (Supabase Auth) instead of the old
// single shared password. Staff accounts are created via the Supabase
// Dashboard — there is no public sign-up. See
// STAFF-LOGIN-AND-STOCK-ADJUSTMENTS-HANDOFF.md for details.
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow the login page through unauthenticated.
  if (pathname === '/admin/login') return NextResponse.next()

  if (!pathname.startsWith('/admin')) return NextResponse.next()

  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          // Mirror refreshed auth cookies onto both the incoming request (so
          // this same pass sees them) and the outgoing response.
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    }
  )

  const { data } = await supabase.auth.getUser()

  if (!data.user) {
    const loginUrl = new URL('/admin/login', request.url)
    loginUrl.searchParams.set('from', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return response
}

export const config = {
  matcher: ['/admin/:path*'],
}
