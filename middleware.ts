import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const ADMIN_COOKIE = 'admin_auth'
const CATALOG_COOKIE = 'catalog_access'

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  // ── Admin: shared-password cookie gate ───────────────────────────────────
  if (pathname.startsWith('/admin')) {
    if (pathname === '/admin/login') return NextResponse.next()
    const authCookie = request.cookies.get(ADMIN_COOKIE)
    if (!authCookie || authCookie.value !== 'authenticated') {
      const loginUrl = new URL('/admin/login', request.url)
      loginUrl.searchParams.set('from', pathname)
      return NextResponse.redirect(loginUrl)
    }
    return NextResponse.next()
  }

  // The gate page and its API must stay reachable; APIs are called by the
  // browser after entry and aren't gated here.
  if (pathname === '/enter' || pathname.startsWith('/api')) return NextResponse.next()

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

  return NextResponse.next()
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
}
