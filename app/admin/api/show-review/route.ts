import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth-server'
import { SHOW_REVIEW_KEEP, SHOW_REVIEW_REOPEN } from '@/lib/show-review'

// Lives under /admin, so middleware.ts already requires the admin login.
//
// POST /admin/api/show-review { id, action: 'keep' | 'reopen' }
//   keep    the owner looked and wants it hidden: it leaves /admin/show-review
//   reopen  put it back on the list
// "Show" isn't here: it's PATCH /admin/api/products { manually_hidden: false },
// which logs product_visibility_changed and refuses a $0 product.
// The decision IS the audit row (latest of the two actions wins), so no table
// is needed; it's written directly so a failure is reported, not swallowed.

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { id?: unknown; action?: unknown } | null
  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  const action = body?.action
  if (!id || (action !== 'keep' && action !== 'reopen')) {
    return NextResponse.json({ error: 'Send { id, action: "keep" | "reopen" }' }, { status: 400 })
  }
  try {
    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()
    const { data: p, error: pErr } = await db.from('products').select('id, sku').eq('id', id).maybeSingle()
    if (pErr) throw pErr
    if (!p) return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    const { error } = await db.from('audit_log').insert({
      action: action === 'keep' ? SHOW_REVIEW_KEEP : SHOW_REVIEW_REOPEN,
      entity_type: 'product',
      entity_id: id,
      entity_label: p.sku,
      old_value: null,
      new_value: action === 'keep' ? 'kept hidden' : 'back on the Show these? list',
      performed_by: (await getSessionUser())?.email ?? 'admin',
    })
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/api/show-review] error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to save' }, { status: 500 })
  }
}
