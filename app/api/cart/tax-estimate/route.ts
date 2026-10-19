import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { getSessionUser } from '@/lib/auth-server'
import { isSignedInAsOrderEmail } from '@/lib/order-rules'
import { estimateSalesTax, loadTaxInputs } from '@/lib/sales-tax'
import { todayPacific } from '@/lib/collections'

export const dynamic = 'force-dynamic'

// POST /api/cart/tax-estimate — { shipState, subtotalCents, email? } -> the
// estimated sales tax the cart shows under its total (lib/sales-tax.ts).
//
// Display only. The subtotal comes from the cart, which is fine for a preview:
// /api/orders recomputes the estimate from its own prices at submit time and
// saves that one. Public like the rest of /api/*, so a resale certificate is
// looked up only for the signed-in buyer's own email, or the typed order
// email when the caller is a rep pricing for that customer.
const MAX_SUBTOTAL_CENTS = 1_000_000_000

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as { shipState?: unknown; subtotalCents?: unknown; email?: unknown }
    const subtotalCents = typeof body.subtotalCents === 'number' && Number.isInteger(body.subtotalCents) ? body.subtotalCents : NaN
    if (!(subtotalCents >= 0 && subtotalCents <= MAX_SUBTOTAL_CENTS) || typeof body.shipState !== 'string') {
      return NextResponse.json({ error: 'shipState and subtotalCents are required.' }, { status: 400 })
    }

    const sessionUser = await getSessionUser()
    const typed = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    let certEmail: string | null = null
    if (sessionUser?.app_metadata?.role === 'rep') certEmail = typed || null
    else if (sessionUser?.email && (!typed || isSignedInAsOrderEmail(sessionUser.email, typed))) certEmail = sessionUser.email.toLowerCase()

    const inputs = await loadTaxInputs(getAdminClient(), certEmail)
    const tax = estimateSalesTax({ shipState: body.shipState, subtotalCents, ...inputs, today: todayPacific() })
    return NextResponse.json({ tax })
  } catch (err) {
    console.error('[cart/tax-estimate] error:', err)
    return NextResponse.json({ error: 'Could not estimate tax.' }, { status: 500 })
  }
}
