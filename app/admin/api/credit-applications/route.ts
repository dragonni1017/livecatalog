import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { getSessionUser } from '@/lib/auth-server'
import { logAudit } from '@/lib/audit'
import { isSmtpConfigured, sendMail } from '@/lib/email'

export const dynamic = 'force-dynamic'

// Approve / decline a net-terms application. This route lives under /admin,
// so middleware.ts already gates it behind the admin role — no extra auth
// check needed here beyond reading who the acting admin is for the audit
// trail.
//
// Unlike order approval (which keys into QuickBooks and is one-way), a
// credit decision is reversible: status can be set back to 'pending', which
// clears the recorded decision. The applicant is only emailed on an actual
// approve/decline, never on a reopen.

const TERMS = ['net-30', 'net-60'] as const
const DECISIONS = ['approved', 'denied', 'pending'] as const

type Decision = (typeof DECISIONS)[number]

const TERMS_LABEL: Record<string, string> = {
  'net-30': 'Net 30',
  'net-60': 'Net 60',
}

// PATCH { id, status, approved_terms?, review_notes?, notify? }
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()

    const id: string = typeof body.id === 'string' ? body.id : ''
    const status = body.status as Decision
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    if (!DECISIONS.includes(status)) {
      return NextResponse.json({ error: 'Status must be approved, denied, or pending.' }, { status: 400 })
    }

    const reviewNotes = typeof body.review_notes === 'string' ? body.review_notes.trim() : ''
    const notify = body.notify !== false

    const db = getAdminClient()
    const { data: existing, error: loadError } = await db
      .from('credit_applications')
      .select('*')
      .eq('id', id)
      .single()

    if (loadError || !existing) {
      return NextResponse.json({ error: 'Application not found.' }, { status: 404 })
    }

    // Approving records the terms actually granted, which may be shorter
    // than what was requested. Default to the requested terms so the common
    // "approve as asked" case needs no extra input.
    let approvedTerms: string | null = null
    if (status === 'approved') {
      approvedTerms = typeof body.approved_terms === 'string' && body.approved_terms
        ? body.approved_terms
        : existing.requested_terms
      if (!TERMS.includes(approvedTerms as (typeof TERMS)[number])) {
        return NextResponse.json({ error: 'Approved terms must be net-30 or net-60.' }, { status: 400 })
      }
    }

    const sessionUser = await getSessionUser()
    const actor = sessionUser?.email ?? 'admin'
    const decided = status !== 'pending'

    const { data: updated, error } = await db
      .from('credit_applications')
      .update({
        status,
        approved_terms: approvedTerms,
        review_notes:  decided ? (reviewNotes || null) : null,
        reviewed_by:   decided ? actor : null,
        reviewed_at:   decided ? new Date().toISOString() : null,
      })
      .eq('id', id)
      .select('*')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })

    await logAudit({
      action: status === 'approved'
        ? 'credit_application_approved'
        : status === 'denied'
          ? 'credit_application_denied'
          : 'credit_application_reopened',
      entity_type: 'credit_application',
      entity_id: id,
      entity_label: existing.company_name,
      old_value: existing.status,
      new_value: status === 'approved' ? `approved (${approvedTerms})` : status,
      performed_by: actor,
    })

    // Best-effort applicant email — a mail failure must not make the admin
    // think the decision didn't save (it already has).
    let emailed = false
    let emailError: string | null = null
    if (decided && notify && isSmtpConfigured()) {
      try {
        await sendMail({
          to: existing.email,
          subject: status === 'approved'
            ? `Your net-terms application is approved — ${existing.company_name}`
            : `Regarding your net-terms application — ${existing.company_name}`,
          text: status === 'approved'
            ? [
                `Hi ${existing.contact_name},`,
                ``,
                `Good news — ${existing.company_name} has been approved for ${TERMS_LABEL[approvedTerms!] ?? approvedTerms} payment terms.`,
                ...(approvedTerms !== existing.requested_terms
                  ? [``, `You applied for ${TERMS_LABEL[existing.requested_terms] ?? existing.requested_terms}; we've approved ${TERMS_LABEL[approvedTerms!] ?? approvedTerms} to start, and we can revisit that as your account builds history with us.`]
                  : []),
                ...(reviewNotes ? [``, reviewNotes] : []),
                ``,
                `Your terms will be applied to orders going forward. If you have any questions, just reply to this email.`,
                ``,
                `— L & Y USA`,
              ].join('\n')
            : [
                `Hi ${existing.contact_name},`,
                ``,
                `Thank you for applying for payment terms with L & Y USA. After reviewing the application for ${existing.company_name}, we're not able to extend net terms at this time.`,
                ...(reviewNotes ? [``, reviewNotes] : []),
                ``,
                `You're very welcome to keep ordering on prepaid terms, and we'd be glad to look at this again later. Just reply to this email if you'd like to discuss it.`,
                ``,
                `— L & Y USA`,
              ].join('\n'),
          replyTo: process.env.SALES_ALERT_TO,
          from: process.env.SALES_ALERT_FROM || undefined,
        })
        emailed = true
      } catch (mailErr) {
        console.error('[admin/credit-applications PATCH] applicant email failed:', mailErr)
        emailError = 'The decision was saved, but the notification email could not be sent.'
      }
    }

    return NextResponse.json({ application: updated, emailed, emailError })
  } catch (err) {
    console.error('[admin/credit-applications PATCH] error:', err)
    return NextResponse.json({ error: 'Failed to update application.' }, { status: 500 })
  }
}
