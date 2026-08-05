import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { isSmtpConfigured, sendMail } from '@/lib/email'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const reference = typeof body.reference === 'string' ? body.reference.trim().toUpperCase() : ''
    const message = typeof body.message === 'string' ? body.message.trim() : ''

    if (!reference || !message) {
      return NextResponse.json({ error: 'Missing reference or message.' }, { status: 400 })
    }
    if (message.length > 2000) {
      return NextResponse.json({ error: 'Message too long.' }, { status: 400 })
    }

    const db = getAdminClient()
    const { data: order } = await db
      .from('order_requests')
      .select('reference_code, customer_name, customer_email')
      .eq('reference_code', reference)
      .single()

    if (!order) {
      return NextResponse.json({ error: 'Order not found.' }, { status: 404 })
    }

    if (!isSmtpConfigured() || !process.env.SALES_ALERT_TO) {
      console.warn('[order-reply] SMTP / SALES_ALERT_TO not set — skipping send')
      return NextResponse.json({ ok: true })
    }

    await sendMail({
      to: process.env.SALES_ALERT_TO,
      subject: `Customer message — ${order.reference_code}`,
      text:
        `A customer sent a message about order ${order.reference_code}.\n\n` +
        `From: ${order.customer_name} <${order.customer_email}>\n\n` +
        `Message:\n${message}\n\n` +
        `Reply to this email to respond directly to the customer.\n`,
      replyTo: order.customer_email,
      from: process.env.SALES_ALERT_FROM || process.env.TITAN_SMTP_USER,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[order-reply] error:', err)
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}
