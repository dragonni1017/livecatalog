import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { getActorEmail } from '@/lib/auth-server'
import { logAudit } from '@/lib/audit'
import { RESALE_CERT_STATUSES, type ResaleCertStatus } from '@/lib/resale-certificates'

export const dynamic = 'force-dynamic'

// Verify / reject / reopen a customer's resale certificate. Under /admin, so
// middleware.ts already requires the admin role. A record only: nothing
// downstream reads the status, and no email is sent to the customer.

// PATCH { id, status, review_notes? }
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const id = typeof body.id === 'string' ? body.id : ''
    const status = body.status as ResaleCertStatus
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    if (!RESALE_CERT_STATUSES.includes(status)) {
      return NextResponse.json({ error: 'Status must be pending, verified, or rejected.' }, { status: 400 })
    }
    const notes = typeof body.review_notes === 'string' ? body.review_notes.trim().slice(0, 1000) : ''

    const db = getAdminClient()
    const { data: existing, error: loadError } = await db
      .from('resale_certificates')
      .select('id, email, state, permit_number, status')
      .eq('id', id)
      .single()
    if (loadError || !existing) return NextResponse.json({ error: 'Certificate not found.' }, { status: 404 })

    const actor = await getActorEmail()
    const decided = status !== 'pending'
    const { data: updated, error } = await db
      .from('resale_certificates')
      .update({
        status,
        review_notes: decided ? notes || null : null,
        reviewed_by: decided ? actor : null,
        reviewed_at: decided ? new Date().toISOString() : null,
      })
      .eq('id', id)
      .select('*')
      .single()
    if (error || !updated) {
      console.error('[admin/resale-certificates PATCH]', error?.message)
      return NextResponse.json({ error: 'Could not update the certificate.' }, { status: 500 })
    }

    await logAudit({
      action: `resale_certificate_${status}`,
      entity_type: 'resale_certificate',
      entity_id: id,
      entity_label: `${existing.email} (${existing.state} ${existing.permit_number})`,
      old_value: existing.status,
      new_value: status,
      performed_by: actor,
    })

    return NextResponse.json({ certificate: updated })
  } catch (err) {
    console.error('[admin/resale-certificates PATCH] error:', err)
    return NextResponse.json({ error: 'Could not update the certificate.' }, { status: 500 })
  }
}
