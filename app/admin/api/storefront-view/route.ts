import { NextRequest, NextResponse } from 'next/server'
import { draftMode } from 'next/headers'

export const dynamic = 'force-dynamic'

// Turns the storefront's "show all products" view on (GET, from the admin
// dashboard link) or off (POST, from the bar on the storefront). See
// lib/admin-catalog-view.ts. Under /admin, so middleware.ts already requires
// an admin session for both.

/** Only same-site paths, so `from` can't send anyone off-site. */
function safePath(raw: string | null): string {
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/'
}

export async function GET(request: NextRequest) {
  ;(await draftMode()).enable()
  return NextResponse.redirect(new URL(safePath(request.nextUrl.searchParams.get('from')), request.url), { status: 303 })
}

export async function POST(request: NextRequest) {
  ;(await draftMode()).disable()
  const form = await request.formData().catch(() => null)
  return NextResponse.redirect(new URL(safePath(form?.get('from')?.toString() ?? null), request.url), { status: 303 })
}
