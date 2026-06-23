import { NextRequest, NextResponse } from 'next/server'
import type { OrderStatus } from '@/lib/types'

// This route lives under /admin, so middleware.ts already gates it behind the
// admin auth cookie — no extra auth check needed here.

const VALID: OrderStatus[] = ['new', 'contacted', 'converted', 'lost']

function isMockMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return !url || url === 'your-supabase-url' || url.includes('placeholder')
}

// PATCH /admin/api/orders — change an order's status
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const id: string = body.id
    const status: OrderStatus = body.status

    if (!id || !VALID.includes(status)) {
      return NextResponse.json({ error: 'Invalid id or status' }, { status: 400 })
    }

    if (isMockMode()) {
      return NextResponse.json({ ok: true, mock: true })
    }

    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()
    const now = new Date().toISOString()

    const { error } = await db
      .from('order_requests')
      .update({
        status,
        // Single shared admin login — no per-user identity to record.
        status_changed_by: 'admin',
        status_changed_at: now,
        updated_at: now,
      })
      .eq('id', id)
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/orders PATCH] error:', err)
    return NextResponse.json({ error: 'Failed to update order' }, { status: 500 })
  }
}
