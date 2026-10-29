import { NextRequest, NextResponse } from 'next/server'
import { logAudit } from '@/lib/audit'
import { findRep } from '@/lib/order-owner'
import { loadRepAccounts } from '@/lib/rep-accounts'

// Lives under /admin, so middleware.ts already requires the admin login.
//
// POST /admin/api/orders/owner  { id, email: '<rep email>' | null }
//
// Sets (or clears, with null) who follows up an order:
// order_requests.assigned_rep_email + assigned_at (migration 0069). Only an
// existing rep account can be chosen. No email, status, stock or QuickBooks
// effect: the status PATCH route is untouched.

function isMockMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return !url || url === 'your-supabase-url' || url.includes('placeholder')
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  const raw = body?.email
  if (!id) return NextResponse.json({ error: 'Missing order id' }, { status: 400 })
  if (raw !== null && typeof raw !== 'string') {
    return NextResponse.json({ error: 'Owner must be a rep email or null' }, { status: 400 })
  }

  if (isMockMode()) return NextResponse.json({ ok: true, mock: true })

  try {
    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()

    let email: string | null = null
    if (typeof raw === 'string' && raw.trim()) {
      const rep = findRep(raw, await loadRepAccounts(db))
      if (!rep) return NextResponse.json({ error: 'That is not a rep account.' }, { status: 400 })
      email = rep.email
    }

    const { data: current, error: readError } = await db
      .from('order_requests')
      .select('reference_code, assigned_rep_email')
      .eq('id', id)
      .maybeSingle()
    if (readError) throw readError
    if (!current) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    if ((current.assigned_rep_email ?? null) === email) return NextResponse.json({ ok: true, unchanged: true })

    const { error } = await db
      .from('order_requests')
      .update({ assigned_rep_email: email, assigned_at: email ? new Date().toISOString() : null })
      .eq('id', id)
    if (error) throw error

    await logAudit({
      action: 'order_owner_set',
      entity_type: 'order',
      entity_id: id,
      entity_label: current.reference_code,
      old_value: current.assigned_rep_email ?? undefined,
      new_value: email ?? 'unassigned',
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/orders/owner] error:', err)
    return NextResponse.json({ error: 'Failed to update owner' }, { status: 500 })
  }
}
