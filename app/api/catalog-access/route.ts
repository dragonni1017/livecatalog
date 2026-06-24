import { NextRequest, NextResponse } from 'next/server'

const COOKIE = 'catalog_access'
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
  const from = formData.get('from')?.toString() || '/'
  const expected = process.env.CATALOG_ACCESS_CODE

  if (!expected || code !== expected) {
    const url = new URL('/enter', request.url)
    url.searchParams.set('error', '1')
    url.searchParams.set('from', from)
    return NextResponse.redirect(url, { status: 303 })
  }

  // Only honor internal redirect targets (no open redirect).
  const dest = from.startsWith('/') && !from.startsWith('//') ? from : '/'
  const response = NextResponse.redirect(new URL(dest, request.url), { status: 303 })
  response.cookies.set(COOKIE, 'granted', COOKIE_OPTIONS)
  return response
}
