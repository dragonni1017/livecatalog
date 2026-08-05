import { NextRequest, NextResponse } from 'next/server'
import type { OrderStatus } from '@/lib/types'
import { logAudit } from '@/lib/audit'
import { notifyOrderStatusChange } from '@/lib/order-emails'

// This route lives under /admin, so middleware.ts already gates it behind the
// admin auth cookie — no extra auth check needed here.

const VALID: OrderStatus[] = ['new', 'contacted', 'converted', 'lost']

function isMockMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return !url || url === 'your-supabase-url' || url.includes('placeholder')
}

// PATCH /admin/api/orders — change an order's status and/or its
// "entered in QuickBooks" flag. Accepts { id, status? } and/or { id, enteredInQb? }.
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const id: string = body.id
    const hasStatus = body.status !== undefined
    const hasEntered = body.enteredInQb !== undefined

    if (!id || (!hasStatus && !hasEntered)) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }
    if (hasStatus && !VALID.includes(body.status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    }

    if (isMockMode()) {
      return NextResponse.json({ ok: true, mock: true })
    }

    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()
    const now = new Date().toISOString()

    // Fetch current values before updating so we can record old_value in the audit log
    const { data: current } = await db
      .from('order_requests')
      .select('status, entered_in_qb')
      .eq('id', id)
      .single()

    const patch: Record<string, unknown> = { updated_at: now }
    if (hasStatus) {
      patch.status = body.status as OrderStatus
      // Single shared admin login — no per-user identity to record.
      patch.status_changed_by = 'admin'
      patch.status_changed_at = now
    }
    if (hasEntered) {
      patch.entered_in_qb = Boolean(body.enteredInQb)
      patch.entered_in_qb_at = body.enteredInQb ? now : null
    }

    const { error } = await db.from('order_requests').update(patch).eq('id', id)
    if (error) throw error

    await logAudit({
      action: hasStatus ? 'order_status_change' : 'order_qb_toggle',
      entity_type: 'order',
      entity_id: id,
      old_value: hasStatus ? (current?.status ?? undefined) : (current != null ? String(current.entered_in_qb) : undefined),
      new_value: hasStatus ? body.status : String(body.enteredInQb),
    })

    // Best-effort customer notification — never blocks the response
    if (hasStatus && (body.status === 'contacted' || body.status === 'converted' || body.status === 'lost')) {
      await notifyOrderStatusChange({ orderId: id, status: body.status, db })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/orders PATCH] error:', err)
    return NextResponse.json({ error: 'Failed to update order' }, { status: 500 })
  }
}
