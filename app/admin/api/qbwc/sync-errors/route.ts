import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { logAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// This route lives under /admin, so middleware.ts already gates it behind
// the admin auth cookie — no extra auth check needed here.
//
// qb_sync_queue rows never leave 'error' on their own — /api/qbwc's
// sendRequestXML only ever queries status='pending' — so this is the escape
// hatch for retrying a failed sync (most failures so far have been
// transient QuickBooks-side conflicts/rejections, not bad data).
//
// A 'sent' row is a second, riskier way to get stuck: sendRequestXML marks
// the row 'sent' before handing qbXML to QBWC, then waits for
// receiveResponseXML to mark it 'acked'/'error'. If the connection drops in
// between (confirmed via a live probe 2026-08-31 -- a forged ticket sent the
// real SalesOrderAdd, then a second forged ticket simulating a reconnect
// correctly found nothing to resend, proving no automatic duplicate-send
// risk), the row is stuck at 'sent' forever: not 'pending' (won't retry),
// not 'error' (invisible to the panel above). Surfaced here as "stuck" once
// stale for a while, with a stronger warning than a plain error retry --
// unlike 'error' (QuickBooks explicitly rejected it, nothing was created),
// a 'sent' row might have actually succeeded in QuickBooks with only the
// confirmation lost, so retrying it for real risks a genuine duplicate
// Sales Order.
const STUCK_SENT_THRESHOLD_MINUTES = 10

// GET — every order currently stuck in 'error' or stale 'sent', most recent first.
export async function GET() {
  const db = getAdminClient()

  const staleBefore = new Date(Date.now() - STUCK_SENT_THRESHOLD_MINUTES * 60_000).toISOString()
  const { data: rows, error } = await db
    .from('qb_sync_queue')
    .select('id, order_id, status, error_message, updated_at')
    .or(`status.eq.error,and(status.eq.sent,updated_at.lt.${staleBefore})`)
    .order('updated_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!rows || rows.length === 0) return NextResponse.json({ errors: [] })

  const orderIds = rows.map((r) => r.order_id)
  const { data: orders, error: ordersError } = await db
    .from('order_requests')
    .select('id, reference_code, customer_name, customer_company')
    .in('id', orderIds)
  if (ordersError) return NextResponse.json({ error: ordersError.message }, { status: 500 })
  const orderById = new Map((orders ?? []).map((o) => [o.id, o]))

  const errors = rows.map((r) => {
    const order = orderById.get(r.order_id)
    return {
      queueId: r.id,
      orderId: r.order_id,
      kind: r.status === 'sent' ? ('stuck' as const) : ('error' as const),
      referenceCode: order?.reference_code ?? '(order not found)',
      customerLabel: order?.customer_company || order?.customer_name || '',
      errorMessage: r.error_message,
      updatedAt: r.updated_at,
    }
  })

  return NextResponse.json({ errors })
}

// POST { queueId } — reset one failed OR stuck-sent row back to 'pending' so
// the next Web Connector poll retries it from scratch.
export async function POST(request: NextRequest) {
  const body = await request.json()
  const queueId = typeof body.queueId === 'string' ? body.queueId.trim() : ''
  if (!queueId) return NextResponse.json({ error: 'Missing queueId' }, { status: 400 })

  const db = getAdminClient()
  const { data: row, error: fetchError } = await db
    .from('qb_sync_queue')
    .select('id, order_id, status')
    .eq('id', queueId)
    .maybeSingle()
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (row.status !== 'error' && row.status !== 'sent') {
    return NextResponse.json({ error: `Row is '${row.status}' — nothing to retry.` }, { status: 400 })
  }

  const { error } = await db
    .from('qb_sync_queue')
    .update({ status: 'pending', error_message: null, updated_at: new Date().toISOString() })
    .eq('id', queueId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAudit({
    action: row.status === 'sent' ? 'qb_sync_force_retry' : 'qb_sync_retry',
    entity_type: 'qb_sync_queue',
    entity_id: row.order_id,
    entity_label: row.order_id,
  })

  return NextResponse.json({ ok: true })
}
