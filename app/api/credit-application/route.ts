import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { isSmtpConfigured, sendMail } from '@/lib/email'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const companyName = body.company_name?.trim()
    const contactName = body.contact_name?.trim()
    const email = body.email?.trim().toLowerCase()
    const requestedTerms = body.requested_terms ?? 'net-30'

    if (!companyName || !contactName || !email) {
      return NextResponse.json({ error: 'Company name, contact name, and email are required.' }, { status: 400 })
    }
    if (!['net-30', 'net-60'].includes(requestedTerms)) {
      return NextResponse.json({ error: 'Invalid terms selection.' }, { status: 400 })
    }

    const db = getAdminClient()
    const { error } = await db.from('credit_applications').insert({
      company_name:             companyName,
      contact_name:             contactName,
      email,
      phone:                    body.phone?.trim() || null,
      address:                  body.address?.trim() || null,
      years_in_business:        body.years_in_business || null,
      annual_purchase_estimate: body.annual_purchase_estimate || null,
      requested_terms:          requestedTerms,
      trade_references:         body.trade_references?.trim() || null,
      notes:                    body.notes?.trim() || null,
    })

    if (error) throw error

    // Notify the sales team
    const to = process.env.SALES_ALERT_TO
    if (isSmtpConfigured() && to) {
      await sendMail({
        to,
        subject: `Net-terms application — ${companyName}`,
        text: [
          `New net-terms credit application received.`,
          ``,
          `Company:   ${companyName}`,
          `Contact:   ${contactName}`,
          `Email:     ${email}`,
          `Phone:     ${body.phone || '—'}`,
          `Address:   ${body.address || '—'}`,
          ``,
          `Requested terms:         ${requestedTerms}`,
          `Years in business:       ${body.years_in_business || '—'}`,
          `Est. annual purchases:   ${body.annual_purchase_estimate || '—'}`,
          ``,
          `Trade references:`,
          body.trade_references || '(none provided)',
          ``,
          `Additional notes:`,
          body.notes || '(none)',
          ``,
          `Review at: ${process.env.NEXT_PUBLIC_SITE_URL ?? 'https://livecatalog.vercel.app'}/admin/credit-applications`,
        ].join('\n'),
      })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[credit-application] error:', err)
    return NextResponse.json({ error: 'Failed to submit application. Please try again.' }, { status: 500 })
  }
}
