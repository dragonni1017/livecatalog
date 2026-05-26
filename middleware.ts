import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const ADMIN_COOKIE = 'admin_auth'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow the login page and its POST action through
  if (pathname === '/admin/login') return NextResponse.next()

  // Protect all other /admin/* routes
  if (pathname.startsWith('/admin')) {
    const authCookie = request.cookies.get(ADMIN_COOKIE)
    if (!authCookie || authCookie.value !== 'authenticated') {
      const loginUrl = new URL('/admin/login', request.url)
      loginUrl.searchParams.set('from', pathname)
      return NextResponse.redirect(loginUrl)
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*'],
}
