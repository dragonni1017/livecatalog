import { NextRequest, NextResponse } from 'next/server'
import { safeInternalPath } from '@/lib/safe-redirect'
import { safeEqual } from '@/lib/request-auth'
import { CATALOG_COOKIE, catalogAccessToken } from '@/lib/catalog-gate'

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 60 * 60 * 24 * 30, // 30 days
}

// POST /api/catalog-access — verify the shared catalog access code (set via the
// CATALOG_ACCESS_CODE env var) and, on success, set the cookie middleware checks.
export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const code = formData.get('code')?.toString() ?? ''
  const from = safeInternalPath(formData.get('from')?.toString(), '/')
  const expected = process.env.CATALOG_ACCESS_CODE

  if (!expected || !safeEqual(code, expected)) {
    const url = new URL('/enter', request.url)
    url.searchParams.set('error', '1')
    url.searchParams.set('from', from)
    return NextResponse.redirect(url, { status: 303 })
  }

  // `from` is already same-site (safeInternalPath above). The old
  // startsWith('/') && !startsWith('//') check let "/\evil.com" through,
  // which browsers read as //evil.com.
  const response = NextResponse.redirect(new URL(from, request.url), { status: 303 })
  // An HMAC of the code (lib/catalog-gate.ts). The literal 'granted' used to
  // be settable by anyone, by hand.
  response.cookies.set(CATALOG_COOKIE, await catalogAccessToken(expected), { ...COOKIE_OPTIONS, secure: true })
  return response
}
