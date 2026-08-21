import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { logAudit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// This route lives under /admin, so middleware.ts already gates it behind
// the admin auth cookie — no extra auth check needed here.
//
// Lets admin pre-link a real order-placing email to an EXISTING QuickBooks
// customer (found via the qb_customer_directory pull) before that
// customer's first order ever syncs — avoids /api/qbwc's automatic
// CustomerAddRq fallback creating a duplicate when the order's
// company/customer name doesn't exactly match how they're already filed in
// QuickBooks (CustomerQueryRq has no email filter, name-only).

// GET — every distinct email that has placed an order, with its current
// QuickBooks link status (if any), most recent orders first.
export async function GET() {
  const db = getAdminClient()

  const { data: orders, error: ordersError } = await db
    .from('order_requests')
    .select('customer_email, customer_name, customer_company, created_at')
    .order('created_at', { ascending: false })
    .limit(500)
  if (ordersError) return NextResponse.json({ error: ordersError.message }, { status: 500 })

  const { data: links, error: linksError } = await db
    .from('qb_customer_links')
    .select('email, qb_customer_list_id, qb_customer_full_name, last_synced_at, last_sync_source')
  if (linksError) return NextResponse.json({ error: linksError.message }, { status: 500 })
  const linkByEmail = new Map((links ?? []).map((l) => [l.email, l]))

  const seen = new Set<string>()
  const buyers: Array<{
    email: string
    name: string
    company: string | null
    lastOrderAt: string
    link: { qb_customer_list_id: string | null; qb_customer_full_name: string | null; last_sync_source: string | null } | null
  }> = []
  for (const o of orders ?? []) {
    const email = o.customer_email.toLowerCase()
    if (seen.has(email)) continue
    seen.add(email)
    const link = linkByEmail.get(email)
    buyers.push({
      email,
      name: o.customer_name,
      company: o.customer_company,
      lastOrderAt: o.created_at,
      link: link ? { qb_customer_list_id: link.qb_customer_list_id, qb_customer_full_name: link.qb_customer_full_name, last_sync_source: link.last_sync_source } : null,
    })
  }

  return NextResponse.json({ buyers })
}

// POST { email, qb_customer_list_id, qb_customer_full_name } — manually
// link a buyer email to an existing QuickBooks customer.
export async function POST(request: NextRequest) {
  const body = await request.json()
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const listId = typeof body.qb_customer_list_id === 'string' ? body.qb_customer_list_id.trim() : ''
  const fullName = typeof body.qb_customer_full_name === 'string' ? body.qb_customer_full_name.trim() : ''

  if (!email || !listId) {
    return NextResponse.json({ error: 'Email and a QuickBooks customer are required.' }, { status: 400 })
  }

  const db = getAdminClient()
  const { error } = await db.from('qb_customer_links').upsert({
    email,
    qb_customer_list_id: listId,
    qb_customer_full_name: fullName || null,
    last_synced_at: new Date().toISOString(),
    last_sync_source: 'manual',
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAudit({
    action: 'qb_customer_link_created',
    entity_type: 'qb_customer_link',
    entity_id: email,
    entity_label: email,
    new_value: `${fullName} (${listId})`,
  })

  return NextResponse.json({ ok: true })
}

// DELETE ?email=... — remove a link (e.g. it was linked to the wrong
// QuickBooks customer). Deleting the row simply lets /api/qbwc's normal
// name-based lookup/auto-create run again next sync.
export async function DELETE(request: NextRequest) {
  const email = request.nextUrl.searchParams.get('email')?.trim().toLowerCase()
  if (!email) return NextResponse.json({ error: 'Missing email' }, { status: 400 })

  const db = getAdminClient()
  const { error } = await db.from('qb_customer_links').delete().eq('email', email)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logAudit({ action: 'qb_customer_link_removed', entity_type: 'qb_customer_link', entity_id: email, entity_label: email })

  return NextResponse.json({ ok: true })
}
