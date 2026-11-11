import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { isLowStockEmailEnabled, setLowStockEmailEnabled } from '@/lib/alert-settings'
import { logAudit } from '@/lib/audit'

// PATCH /admin/api/alert-settings — { low_stock_email_enabled: boolean }
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null)
    const enabled = body?.low_stock_email_enabled
    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'low_stock_email_enabled must be a boolean' }, { status: 400 })
    }

    const db = getAdminClient()
    const before = await isLowStockEmailEnabled(db)
    await setLowStockEmailEnabled(db, enabled)
    await logAudit({
      action: 'low_stock_email_toggled',
      entity_type: 'setting',
      entity_label: 'Low-stock email',
      old_value: before ? 'on' : 'off',
      new_value: enabled ? 'on' : 'off',
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/alert-settings PATCH] error:', err)
    return NextResponse.json({ error: 'Failed to update alert settings' }, { status: 500 })
  }
}
