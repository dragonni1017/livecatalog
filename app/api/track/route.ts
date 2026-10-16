import { NextRequest, NextResponse } from 'next/server'
import { clientIp, createRateLimiter } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

// Real browsing sends a few events a minute (658 in the 7 days to
// 2026-10-02). Without a cap, one script could add unlimited rows and drown
// the analytics. Over the limit is dropped silently, never an error.
const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 })

function isMockMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return !url || url === 'your-supabase-url' || url.includes('placeholder')
}

const TYPES = new Set(['view', 'search', 'search_no_results', 'add_to_cart', 'cart_view', 'quote_submitted'])
// Funnel steps with no payload beyond the visitor id (see lib/track.ts).
const FUNNEL_TYPES = new Set(['add_to_cart', 'cart_view', 'quote_submitted'])
// lib/track.ts sends a UUID, or a short fallback id where crypto.randomUUID
// is missing. Anything else is dropped to null rather than rejecting the event.
const VISITOR_ID = /^[A-Za-z0-9-]{8,64}$/

// POST /api/track — record a public analytics event (product view, search,
// or a funnel step). Public + unauthenticated by design; inserts go through
// the service-role client. Best-effort: never blocks or errors the user experience.
export async function POST(request: NextRequest) {
  try {
    if (!limiter.hit(clientIp(request))) {
      return NextResponse.json({ ok: true, skipped: true })
    }

    const body = await request.json().catch(() => ({}))
    const type = body.type

    if (typeof type !== 'string' || !TYPES.has(type)) {
      return NextResponse.json({ error: 'invalid type' }, { status: 400 })
    }

    const visitorId = typeof body.visitorId === 'string' && VISITOR_ID.test(body.visitorId)
      ? body.visitorId
      : null

    let productId: string | null = null
    let term: string | null = null

    if (FUNNEL_TYPES.has(type)) {
      // A funnel step means nothing without a visitor to attach it to.
      if (!visitorId) return NextResponse.json({ ok: true, skipped: true })
    } else if (type === 'view') {
      const pid = typeof body.productId === 'string' ? body.productId.trim() : ''
      if (!pid) return NextResponse.json({ error: 'productId required' }, { status: 400 })
      // Real ids are short (prod-NNNNN). The FK rejects unknown ones anyway,
      // so don't send the database a megabyte string first.
      if (pid.length > 64) return NextResponse.json({ error: 'invalid productId' }, { status: 400 })
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
    // 'search_no_results' isn't in analytics_events.type's check constraint;
    // store it as type='search' with a term prefix so it's queryable.
    // visitor_id needs migration 0056: without the column, every insert here
    // fails (views and searches too), so 0056 must be applied before deploy.
    const insertType = type === 'search_no_results' ? 'search' : type
    const insertTerm = type === 'search_no_results' ? `[no_results] ${term}` : term
    const { error } = await db.from('analytics_events').insert({
      type: insertType,
      product_id: productId,
      term: insertTerm,
      visitor_id: visitorId,
    })
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
