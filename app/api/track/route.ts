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

    if (type !== 'view' && type !== 'search' && type !== 'search_no_results') {
      return NextResponse.json({ error: 'invalid type' }, { status: 400 })
    }

    let productId: string | null = null
    let term: string | null = null

    if (type === 'view') {
      const pid = typeof body.productId === 'string' ? body.productId.trim() : ''
      if (!pid) return NextResponse.json({ error: 'productId required' }, { status: 400 })
      productId = pid
    } else {
      // For 'search' events the payload key is `term`; for 'search_no_results' it is `query`.
      const raw = type === 'search_no_results'
        ? (typeof body.query === 'string' ? body.query : '')
        : (typeof body.term === 'string' ? body.term : '')
      // Normalize + bound search terms to limit noise/abuse.
      const t = raw.trim().toLowerCase().slice(0, 100)
      if (t.length < 2) return NextResponse.json({ ok: true, skipped: true }) // too short to be useful
      term = t
    }

    if (isMockMode()) return NextResponse.json({ ok: true, mock: true })

    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()
    // analytics_events.type check constraint only allows 'view' and 'search';
    // store 'search_no_results' as type='search' with a term prefix so it's queryable.
    const insertType = type === 'search_no_results' ? 'search' : type
    const insertTerm = type === 'search_no_results' ? `[no_results] ${term}` : term
    const { error } = await db.from('analytics_events').insert({ type: insertType, product_id: productId, term: insertTerm })
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
