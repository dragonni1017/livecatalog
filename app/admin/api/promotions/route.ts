import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { getActorEmail } from '@/lib/auth-server'
import { logAudit } from '@/lib/audit'
import { parsePromotionInput, PROMOTION_FIELDS } from '@/lib/promotions'

export const dynamic = 'force-dynamic'

// Create / edit / delete promo codes (migration 0064). Under /admin, so
// middleware.ts already requires the admin role. A code that has been used is
// kept for the record: switch it off instead of deleting it.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function dbError(message: string | undefined, fallback: string) {
  if (message?.includes('promotions_code_key') || message?.includes('duplicate key')) {
    return NextResponse.json({ error: 'Another promotion already uses that code.' }, { status: 409 })
  }
  if (message?.includes('foreign key')) {
    return NextResponse.json({ error: 'That collection or category no longer exists.' }, { status: 400 })
  }
  console.error('[admin/promotions]', message)
  return NextResponse.json({ error: fallback }, { status: 500 })
}

// POST {...fields} → { promotion }
export async function POST(request: NextRequest) {
  const parsed = parsePromotionInput(await request.json().catch(() => ({})))
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { data, error } = await getAdminClient().from('promotions').insert(parsed.value).select(PROMOTION_FIELDS).single()
  if (error || !data) return dbError(error?.message, 'Could not create the promotion.')
  await logAudit({ action: 'promotion_created', entity_type: 'promotion', entity_id: data.id, entity_label: data.code, new_value: `${data.percent_off}% off`, performed_by: await getActorEmail() })
  return NextResponse.json({ promotion: data })
}

// PATCH { id, ...fields } → { promotion }   (times_used is never set from here)
export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id : ''
  if (!UUID.test(id)) return NextResponse.json({ error: 'Promotion not found.' }, { status: 404 })
  const parsed = parsePromotionInput(body)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { data, error } = await getAdminClient()
    .from('promotions')
    .update({ ...parsed.value, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(PROMOTION_FIELDS)
    .maybeSingle()
  if (error) return dbError(error.message, 'Could not save the promotion.')
  if (!data) return NextResponse.json({ error: 'Promotion not found.' }, { status: 404 })
  await logAudit({ action: 'promotion_updated', entity_type: 'promotion', entity_id: id, entity_label: data.code, new_value: `${data.percent_off}% off, active=${data.is_active}`, performed_by: await getActorEmail() })
  return NextResponse.json({ promotion: data })
}

// DELETE ?id=… → { ok }   (only never-used codes)
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id') ?? ''
  if (!UUID.test(id)) return NextResponse.json({ error: 'Promotion not found.' }, { status: 404 })
  const db = getAdminClient()
  const { data: existing } = await db.from('promotions').select('code, times_used').eq('id', id).maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Promotion not found.' }, { status: 404 })
  if (existing.times_used > 0) {
    return NextResponse.json({ error: `${existing.code} has been used on orders. Switch it off instead of deleting it.` }, { status: 409 })
  }
  const { error } = await db.from('promotions').delete().eq('id', id).eq('times_used', 0)
  if (error) return dbError(error.message, 'Could not delete the promotion.')
  await logAudit({ action: 'promotion_deleted', entity_type: 'promotion', entity_id: id, entity_label: existing.code, performed_by: await getActorEmail() })
  return NextResponse.json({ ok: true })
}
