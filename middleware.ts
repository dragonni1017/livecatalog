import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const CATALOG_COOKIE = 'catalog_access'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let sessionUser: any = null

  if (supabaseUrl && supabaseAnonKey) {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    })
    const { data: { user } } = await supabase.auth.getUser()
    sessionUser = user
  }

  const { pathname, search } = request.nextUrl

  // ── Admin: Supabase Auth role gate ───────────────────────────────────────
  if (pathname.startsWith('/admin')) {
    if (pathname === '/admin/login') return response
    if (!sessionUser || sessionUser.app_metadata?.role !== 'admin') {
      const loginUrl = new URL('/admin/login', request.url)
      loginUrl.searchParams.set('from', pathname)
      return NextResponse.redirect(loginUrl)
    }
    return response
  }

  // The gate page and its API must stay reachable; APIs are called by the
  // browser after entry and aren't gated here.
  if (pathname === '/enter' || pathname.startsWith('/api')) return response

  // ── Catalog: optional shared access code ─────────────────────────────────
  // Dormant unless CATALOG_ACCESS_CODE is set, so the catalog stays public
  // until you turn the gate on by setting that env var.
  if (process.env.CATALOG_ACCESS_CODE) {
    const access = request.cookies.get(CATALOG_COOKIE)
    if (!access || access.value !== 'granted') {
      const enterUrl = new URL('/enter', request.url)
      enterUrl.searchParams.set('from', pathname + search)
      return NextResponse.redirect(enterUrl)
    }
  }

  return response
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
}
