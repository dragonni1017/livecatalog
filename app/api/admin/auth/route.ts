import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { verifyTotp } from '@/lib/totp'

function makeSupabase(cookieStore: Awaited<ReturnType<typeof cookies>>) {
  return createServerClient(
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
}

// POST /api/admin/auth — handle login
export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') ?? ''
  let email = ''
  let password = ''
  let totp = ''

  if (contentType.includes('application/json')) {
    const body = await request.json()
    email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    password = typeof body.password === 'string' ? body.password : ''
    totp = typeof body.totp === 'string' ? body.totp.trim() : ''
  } else {
    const formData = await request.formData()
    email = formData.get('email')?.toString().trim().toLowerCase() ?? ''
    password = formData.get('password')?.toString() ?? ''
    totp = formData.get('totp')?.toString().trim() ?? ''
  }

  const cookieStore = await cookies()
  const supabase = makeSupabase(cookieStore)

  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    return NextResponse.json({ error: 'Incorrect email or password' }, { status: 401 })
  }

  // Only allow users marked admin via app_metadata (set server-side with service role)
  if (data.user.app_metadata?.role !== 'admin') {
    await supabase.auth.signOut()
    return NextResponse.json({ error: 'Incorrect email or password' }, { status: 401 })
  }

  // Check TOTP if configured
  const totpSecret = process.env.ADMIN_TOTP_SECRET
  if (totpSecret) {
    if (!totp || !verifyTotp(totpSecret, totp)) {
      await supabase.auth.signOut()
      return NextResponse.json({ error: 'Invalid 2FA code', require2fa: true }, { status: 401 })
    }
  }

  return NextResponse.json({ ok: true })
}

// GET /api/admin/auth?action=logout — handle logout
export async function GET(request: NextRequest) {
  const action = request.nextUrl.searchParams.get('action')
  if (action === 'logout') {
    const cookieStore = await cookies()
    const supabase = makeSupabase(cookieStore)
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL('/admin/login', request.url), { status: 303 })
  }
  return NextResponse.redirect(new URL('/admin', request.url), { status: 303 })
}
