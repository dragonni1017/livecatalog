import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { getSessionUser } from '@/lib/auth-server'
import { validateOrderInput, validateOrderMinimum } from '@/lib/order-validation'
import { notifyReps, notifyCustomer } from '@/lib/order-emails'
import { applyTierDiscount } from '@/lib/order-rules'
import { buildLineItems, insertOrder } from '@/lib/order-submission'

export const dynamic = 'force-dynamic'

// POST /rep/api/orders — same shape as /api/orders, plus a required
// `tierCode`. Only reachable by a signed-in rep (middleware.ts gates
// /rep/api/* the same way /admin/api/* is gated for admin).
//
// The tier discount ALWAYS comes from a server-side lookup against
// price_tiers by the submitted code — never a client-supplied percentage —
// and it overrides any customers.discount_percent on file for this order
// rather than stacking with it (locked-in decision, see
// docs/memory/project-rep-price-tier-and-qbwc-plan.md).
export async function POST(request: NextRequest) {
  try {
    const user = await getSessionUser()
    if (!user || user.app_metadata?.role !== 'rep') {
      return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
    }

    const body = await request.json()

    const validation = validateOrderInput(body)
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }
    const { contact, items } = validation

    const tierCode = typeof body.tierCode === 'string' ? body.tierCode.trim() : ''
    if (!tierCode) {
      return NextResponse.json({ error: 'Select a price tier.' }, { status: 400 })
    }

    const db = getAdminClient()

    const { data: tier, error: tierErr } = await db
      .from('price_tiers')
      .select('code, discount_percent, active')
      .eq('code', tierCode)
      .maybeSingle()
    if (tierErr || !tier || !tier.active) {
      return NextResponse.json({ error: 'Invalid or inactive price tier.' }, { status: 400 })
    }
    const discountPct = Number(tier.discount_percent)

    // Attribution comes from the verified session, not client input — the
    // rep placing the order, not whatever the form happened to submit.
    contact.placedByRep = user.email ?? contact.placedByRep

    const built = await buildLineItems(db, items)
    if ('error' in built) {
      return NextResponse.json({ error: built.error }, { status: 500 })
    }
    const { lineItems, outOfStock } = built

    if (lineItems.length === 0) {
      return NextResponse.json(
        { error: 'None of the items in this order are currently available.' },
        { status: 400 },
      )
    }

    if (discountPct > 0) {
      for (const li of lineItems) {
        li.line_total_cents = applyTierDiscount(li.line_total_cents, discountPct)
      }
    }

    const subtotalCents = lineItems.reduce((sum, li) => sum + li.line_total_cents, 0)

    const minErr = validateOrderMinimum(subtotalCents)
    if (minErr) {
      return NextResponse.json({ error: minErr.error }, { status: minErr.status })
    }

    const inserted = await insertOrder({
      db,
      contact,
      lineItems,
      subtotalCents,
      repUserId: user.id,
      appliedTierCode: tier.code,
      appliedTierDiscountPercent: discountPct,
    })
    if (!inserted.ok) {
      return NextResponse.json({ error: inserted.error }, { status: inserted.status })
    }
    const { orderId, referenceCode } = inserted

    await Promise.allSettled([
      notifyReps({ referenceCode, contact, lineItems, subtotalCents, outOfStock, discountPct }),
      notifyCustomer({ referenceCode, contact, lineItems, subtotalCents }),
    ]).then((results) => {
      const labels = ['rep notification', 'customer confirmation']
      results.forEach((r, i) => {
        if (r.status === 'rejected') console.error(`[rep/orders] ${labels[i]} failed (order still saved):`, r.reason)
      })
    })

    return NextResponse.json({ referenceCode, orderId })
  } catch (err) {
    console.error('[rep/orders] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
