import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { getActorEmail } from '@/lib/auth-server'
import { logAudit } from '@/lib/audit'
import { parseSalesTaxInput, SALES_TAX_FIELDS } from '@/lib/sales-tax'
import { US_STATE_NAMES } from '@/lib/us-states'

export const dynamic = 'force-dynamic'

// Estimated sales tax rates per ship-to state (migration 0066,
// lib/sales-tax.ts). Under /admin, so middleware.ts already requires the admin
// role. Removing a state's row is the same as "not collected" there; orders
// already placed keep the estimate they were saved with.

function dbError(message: string | undefined, fallback: string) {
  console.error('[admin/sales-tax]', message)
  return NextResponse.json({ error: fallback }, { status: 500 })
}

// PUT { state, rate_percent, is_active, note } → { row }   (create or replace)
export async function PUT(request: NextRequest) {
  const parsed = parseSalesTaxInput(await request.json().catch(() => ({})))
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const actor = await getActorEmail()
  const { data, error } = await getAdminClient()
    .from('sales_tax_states')
    .upsert({ ...parsed.value, updated_at: new Date().toISOString(), updated_by: actor }, { onConflict: 'state' })
    .select(SALES_TAX_FIELDS)
    .single()
  if (error || !data) return dbError(error?.message, 'Could not save the rate.')
  await logAudit({
    action: 'sales_tax_rate_saved', entity_type: 'sales_tax_state', entity_id: data.state, entity_label: US_STATE_NAMES[data.state],
    new_value: `${Number(data.rate_percent)}%, active=${data.is_active}`, performed_by: actor,
  })
  return NextResponse.json({ row: data })
}

// DELETE ?state=CA → { ok }
export async function DELETE(request: NextRequest) {
  const state = (request.nextUrl.searchParams.get('state') ?? '').toUpperCase()
  if (!US_STATE_NAMES[state]) return NextResponse.json({ error: 'Unknown state.' }, { status: 400 })
  const db = getAdminClient()
  const { data: existing } = await db.from('sales_tax_states').select('rate_percent').eq('state', state).maybeSingle()
  if (!existing) return NextResponse.json({ ok: true })
  const { error } = await db.from('sales_tax_states').delete().eq('state', state)
  if (error) return dbError(error.message, 'Could not remove the rate.')
  await logAudit({
    action: 'sales_tax_rate_removed', entity_type: 'sales_tax_state', entity_id: state, entity_label: US_STATE_NAMES[state],
    old_value: `${Number(existing.rate_percent)}%`, performed_by: await getActorEmail(),
  })
  return NextResponse.json({ ok: true })
}
