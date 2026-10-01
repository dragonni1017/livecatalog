import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { isSmtpConfigured, sendMail } from '@/lib/email'
import { getSessionUser } from '@/lib/auth-server'
import { canAccessOrder } from '@/lib/order-access'

export const dynamic = 'force-dynamic'

// Sends a message to sales "from" an order's customer, with Reply-To set to
// their address. So it takes the same proof as viewing the order (the link
// token or a matching session, see lib/order-access.ts), never the
// guessable reference alone.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    const reference = typeof body.reference === 'string' ? body.reference.trim().toUpperCase() : ''
    const token = typeof body.token === 'string' ? body.token : null
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
      .select('reference_code, customer_name, customer_email, access_token, rep_user_id')
      .eq('reference_code', reference)
      .single()

    // Missing and forbidden answer the same, so this can't test which
    // references exist.
    const user = await getSessionUser()
    if (!order || !canAccessOrder(order, { token, user })) {
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
