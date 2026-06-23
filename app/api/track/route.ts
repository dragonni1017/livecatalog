import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

function isMockMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return !url || url === 'your-supabase-url' || url.includes('placeholder')
}

// POST /api/track — record a public analytics event (product view or search).
// Public + unauthenticated by design; inserts go through the service-role client.
// Best-effort: never blocks or errors the user experience.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const type = body.type

    if (type !== 'view' && type !== 'search') {
      return NextResponse.json({ error: 'invalid type' }, { status: 400 })
    }

    let productId: string | null = null
    let term: string | null = null

    if (type === 'view') {
      const pid = typeof body.productId === 'string' ? body.productId.trim() : ''
      if (!pid) return NextResponse.json({ error: 'productId required' }, { status: 400 })
      productId = pid
    } else {
      // Normalize + bound search terms to limit noise/abuse.
      const t = typeof body.term === 'string' ? body.term.trim().toLowerCase().slice(0, 100) : ''
      if (t.length < 2) return NextResponse.json({ ok: true, skipped: true }) // too short to be useful
      term = t
    }

    if (isMockMode()) return NextResponse.json({ ok: true, mock: true })

    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()
    const { error } = await db.from('analytics_events').insert({ type, product_id: productId, term })
    if (error) {
      // Table may not exist yet (migration 0003 not run) — swallow, never 500 the public site.
      console.error('[track] insert failed:', error.message)
      return NextResponse.json({ ok: false }, { status: 200 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[track] error:', err)
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}
