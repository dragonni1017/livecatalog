import { NextRequest, NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'
import { dismissBlocker, parseDismissBody, type DismissableOrder } from '@/lib/order-dismiss'

// Lives under /admin, so middleware.ts already requires the admin login.
//
// POST /admin/api/orders/dismiss  { id, reason: 'test' | 'duplicate' | 'spam' }
//                                 { id, undo: true }
//
// Deliberately separate from PATCH /admin/api/orders: that route emails the
// customer and, on 'converted', decrements stock and queues QuickBooks.
// Dismissing does none of that. It only sets (or clears) the dismissed_*
// columns from migration 0069 and writes an audit row.

function isMockMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return !url || url === 'your-supabase-url' || url.includes('placeholder')
}

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const req = parseDismissBody(body)
  if ('error' in req) return NextResponse.json({ error: req.error }, { status: 400 })

  if (isMockMode()) return NextResponse.json({ ok: true, mock: true })

  try {
    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()

    const { data: current, error: readError } = await db
      .from('order_requests')
      .select('reference_code, status, entered_in_qb, dismissed_at, dismissed_reason')
      .eq('id', req.id)
      .maybeSingle()
    if (readError) throw readError
    if (!current) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

    if (req.kind === 'undo') {
      if (!current.dismissed_at) return NextResponse.json({ error: 'This order is not dismissed.' }, { status: 409 })
      const { data: rows, error } = await db
        .from('order_requests')
        .update({ dismissed_at: null, dismissed_reason: null, dismissed_by: null, updated_at: new Date().toISOString() })
        .eq('id', req.id)
        .not('dismissed_at', 'is', null)
        .select('id')
      if (error) throw error
      if (!rows?.length) return NextResponse.json({ error: 'This order is not dismissed.' }, { status: 409 })
      await logAudit({
        action: 'order_undismissed',
        entity_type: 'order',
        entity_id: req.id,
        entity_label: current.reference_code,
        old_value: current.dismissed_reason ?? undefined,
      })
      return NextResponse.json({ ok: true })
    }

    const blocker = dismissBlocker(current as DismissableOrder)
    if (blocker) return NextResponse.json({ error: blocker }, { status: 409 })

    // The same conditions again in the WHERE clause, so a status change or a
    // QuickBooks entry made between the read above and this write wins.
    const now = new Date().toISOString()
    const { data: rows, error } = await db
      .from('order_requests')
      .update({ dismissed_at: now, dismissed_reason: req.reason, dismissed_by: 'admin', updated_at: now })
      .eq('id', req.id)
      .eq('status', 'new')
      .eq('entered_in_qb', false)
      .is('dismissed_at', null)
      .select('id')
    if (error) throw error
    if (!rows?.length) {
      return NextResponse.json({ error: 'The order changed while you were looking at it. Reload and try again.' }, { status: 409 })
    }

    await logAudit({
      action: 'order_dismissed',
      entity_type: 'order',
      entity_id: req.id,
      entity_label: current.reference_code,
      new_value: req.reason,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/orders/dismiss] error:', err)
    return NextResponse.json({ error: 'Failed to update order' }, { status: 500 })
  }
}
