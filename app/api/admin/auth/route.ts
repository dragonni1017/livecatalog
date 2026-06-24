import { NextRequest, NextResponse } from 'next/server'

const COOKIE_NAME = 'admin_auth'
const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/admin',
  maxAge: 60 * 60 * 24 * 7, // 7 days
}

// POST /api/admin/auth — handle login
export async function POST(request: NextRequest) {
  const formData = await request.formData()
  const password = formData.get('password')?.toString() ?? ''

  const adminPassword = process.env.ADMIN_PASSWORD
  if (!adminPassword || password !== adminPassword) {
    return NextResponse.redirect(new URL('/admin/login?error=1', request.url), { status: 303 })
  }

  const response = NextResponse.redirect(new URL('/admin', request.url), { status: 303 })
  response.cookies.set(COOKIE_NAME, 'authenticated', COOKIE_OPTIONS)
  return response
}

// GET /api/admin/auth?action=logout — handle logout
export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get('action')
  if (action === 'logout') {
    const response = NextResponse.redirect(new URL('/admin/login', request.url), { status: 303 })
    response.cookies.set(COOKIE_NAME, '', { ...COOKIE_OPTIONS, maxAge: 0 })
    return response
  }
  return NextResponse.redirect(new URL('/admin', request.url), { status: 303 })
}
