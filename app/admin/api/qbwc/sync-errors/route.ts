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

// GET — every order currently stuck in 'error'/'needs_review', or stale 'sent', most recent first.
export async function GET() {
  const db = getAdminClient()

  const staleBefore = new Date(Date.now() - STUCK_SENT_THRESHOLD_MINUTES * 60_000).toISOString()
  const { data: rows, error } = await db
    .from('qb_sync_queue')
    .select('id, order_id, status, error_message, match_candidate_qb_list_id, match_candidate_name, match_candidate_score, updated_at')
    .or(`status.eq.error,status.eq.needs_review,and(status.eq.sent,updated_at.lt.${staleBefore})`)
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
      kind: r.status === 'sent' ? ('stuck' as const) : r.status === 'needs_review' ? ('needs_review' as const) : ('error' as const),
      referenceCode: order?.reference_code ?? '(order not found)',
      customerLabel: order?.customer_company || order?.customer_name || '',
      errorMessage: r.error_message,
      matchCandidateName: r.match_candidate_name,
      matchCandidateScore: r.match_candidate_score,
      updatedAt: r.updated_at,
    }
  })

  return NextResponse.json({ errors })
}

// POST { queueId, action? } — resolves one held row so the next Web
// Connector poll picks it up again:
//   - 'error'/'sent' rows: reset to 'pending' (default action, or 'retry').
//   - 'needs_review' rows: action 'use_match' links the buyer's email to the
//     stored candidate (so this and all future orders from them attach to
//     it), or 'create_new' sets skip_fuzzy_match so the next attempt bypasses
//     the fuzzy check and creates a fresh QuickBooks customer as before.
export async function POST(request: NextRequest) {
  const body = await request.json()
  const queueId = typeof body.queueId === 'string' ? body.queueId.trim() : ''
  const action = typeof body.action === 'string' ? body.action : 'retry'
  if (!queueId) return NextResponse.json({ error: 'Missing queueId' }, { status: 400 })

  const db = getAdminClient()
  const { data: row, error: fetchError } = await db
    .from('qb_sync_queue')
    .select('id, order_id, status, match_candidate_qb_list_id, match_candidate_name')
    .eq('id', queueId)
    .maybeSingle()
  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let skipFuzzyMatch = false

  if (row.status === 'needs_review') {
    if (action === 'use_match') {
      if (!row.match_candidate_qb_list_id) {
        return NextResponse.json({ error: 'No candidate match stored for this row.' }, { status: 400 })
      }
      const { data: order, error: orderError } = await db
        .from('order_requests')
        .select('customer_email')
        .eq('id', row.order_id)
        .maybeSingle()
      if (orderError) return NextResponse.json({ error: orderError.message }, { status: 500 })
      const { error: linkError } = await db.from('qb_customer_links').upsert({
        email: (order?.customer_email ?? '').trim().toLowerCase(),
        qb_customer_list_id: row.match_candidate_qb_list_id,
        qb_customer_full_name: row.match_candidate_name,
        last_synced_at: new Date().toISOString(),
        last_sync_source: 'manual',
      })
      if (linkError) return NextResponse.json({ error: linkError.message }, { status: 500 })
      await logAudit({
        action: 'qb_customer_link_created',
        entity_type: 'qb_customer_link',
        entity_id: order?.customer_email ?? row.order_id,
        entity_label: order?.customer_email ?? row.order_id,
        new_value: `${row.match_candidate_name} (${row.match_candidate_qb_list_id})`,
      })
    } else if (action === 'create_new') {
      // Bypasses the fuzzy check on the next attempt only — this order's
      // candidate wasn't a match, but a future order from a genuinely
      // matching buyer should still get to hold for review.
      skipFuzzyMatch = true
    } else {
      return NextResponse.json({ error: `Unknown action '${action}' for a needs_review row.` }, { status: 400 })
    }
  } else if (row.status !== 'error' && row.status !== 'sent') {
    return NextResponse.json({ error: `Row is '${row.status}' — nothing to retry.` }, { status: 400 })
  }

  const { error } = await db
    .from('qb_sync_queue')
    .update({
      status: 'pending',
      error_message: null,
      match_candidate_qb_list_id: null,
      match_candidate_name: null,
      match_candidate_score: null,
      skip_fuzzy_match: skipFuzzyMatch,
      updated_at: new Date().toISOString(),
    })
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
