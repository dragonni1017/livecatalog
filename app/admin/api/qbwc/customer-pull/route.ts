import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { logAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// This route lives under /admin, so middleware.ts already gates it behind
// the admin auth cookie — no extra auth check needed here.
//
// Triggers/reports on a full (unfiltered) pull of QuickBooks' existing
// customer list into qb_customer_directory, via the singleton
// qb_customer_pull_state row. The actual pull only runs when QuickBooks Web
// Connector next polls /api/qbwc — see handleSendRequestXML's
// customer_full_query branch — so this just flips a flag; it can take up to
// Web Connector's poll interval (15 min by default) to actually start, and
// however many iterator pages the real customer list needs to finish.

// GET — current pull status, for the admin UI to poll.
export async function GET() {
  const db = getAdminClient()
  const { data, error } = await db
    .from('qb_customer_pull_state')
    .select('status, pulled_count, error_message, requested_at, completed_at')
    .eq('id', 1)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { count: directoryCount } = await db
    .from('qb_customer_directory')
    .select('qb_customer_list_id', { count: 'exact', head: true })

  return NextResponse.json({ pull: data, directoryCount: directoryCount ?? 0 })
}

// POST — request a (re)pull. Safe to call again even mid-pull; it just
// resets to 'requested' with a fresh iterator, so a stuck/errored pull can
// always be restarted from the beginning.
export async function POST() {
  const db = getAdminClient()
  const { error } = await db
    .from('qb_customer_pull_state')
    .update({
      status: 'requested',
      iterator_id: null,
      pulled_count: 0,
      error_message: null,
      requested_at: new Date().toISOString(),
      completed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', 1)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAudit({ action: 'qb_customer_pull_requested', entity_type: 'qb_customer_pull' })

  return NextResponse.json({ ok: true })
}
