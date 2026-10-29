import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { getSessionUser } from '@/lib/auth-server'
import { validateOrderInput, validateOrderMinimum } from '@/lib/order-validation'
import { notifyReps, notifyCustomer } from '@/lib/order-emails'
import { isSignedInAsOrderEmail } from '@/lib/order-rules'
import { buildLineItems, insertOrder } from '@/lib/order-submission'
import { autoAssignOrder } from '@/lib/order-auto-assign'
import { TIER_COOKIE } from '@/lib/rep-tier-shared'
import { resolveCustomerPricing } from '@/lib/customer-pricing'
import { loadPromotion, priceWithPromotion } from '@/lib/promotions'
import { estimateSalesTax, loadTaxInputs, taxColumns } from '@/lib/sales-tax'
import { todayPacific } from '@/lib/collections'

export const dynamic = 'force-dynamic'

function isMockMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return !url || url === 'your-supabase-url' || url.includes('placeholder')
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // ── 1. Validate input (Django form-validation pattern) ───────────────────
    const validation = validateOrderInput(body)
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: validation.status })
    }
    const { contact, items } = validation

    if (isMockMode()) {
      return NextResponse.json({ referenceCode: 'ORD-MOCK-0001', orderId: 'mock' })
    }

    const db = getAdminClient()

    // ── 2. Re-fetch authoritative product data (never trust client prices) ───
    const built = await buildLineItems(db, items)
    if ('error' in built) {
      return NextResponse.json({ error: built.error }, { status: 500 })
    }
    const { lineItems, outOfStock } = built

    if (lineItems.length === 0) {
      return NextResponse.json(
        { error: 'None of the items in your cart are currently available.' },
        { status: 400 },
      )
    }

    // ── 2b. Apply pricing: a real rep's selected tier overrides any customer
    // file discount for this order (never stacked) — mirrors the header
    // TierSwitcher's display-only cookie, but re-verified here against the
    // actual session and price_tiers table, never trusted from the client.
    let discountPct = 0
    let repUserId: string | null = null
    let appliedTierCode: string | null = null

    const sessionUser = await getSessionUser()
    const isRep = sessionUser?.app_metadata?.role === 'rep'
    if (isRep) {
      const tierCode = request.cookies.get(TIER_COOKIE)?.value
      if (tierCode) {
        const { data: tier } = await db
          .from('price_tiers')
          .select('code, discount_percent, active')
          .eq('code', tierCode)
          .maybeSingle()
        if (tier?.active) {
          discountPct = Number(tier.discount_percent)
          repUserId = sessionUser!.id
          appliedTierCode = tier.code
          // Attribution comes from the verified session, not client input.
          contact.placedByRep = sessionUser!.email ?? contact.placedByRep
        }
      }
    }

    // ── 2c. A customer directly assigned a price tier (app/admin/customers)
    // gets that tier's pricing, and failing that their flat discount_percent.
    // The tier wins when both are set (never stacked), the same override rule
    // as the rep-tier case above.
    //
    // ONLY when signed in as that customer: the session's email must match
    // the order email. This used to resolve by the typed email alone, with
    // no login, so anyone who knew a tiered customer's email got their
    // pricing on a quote (2026-10-01 /api audit). Guests and mismatched
    // emails get standard pricing, the same as /api/cart/reprice already
    // shows them in the cart. A rep pricing for a customer uses the tier
    // switcher (2b), not the customer's email.
    const orderEmail = contact.email.trim().toLowerCase()
    if (!appliedTierCode && isSignedInAsOrderEmail(sessionUser?.email, orderEmail)) {
      // Same rule as the cart preview and priced price lists (lib/customer-pricing.ts).
      const pricing = await resolveCustomerPricing(db, orderEmail)
      discountPct = pricing.discountPct
      if (pricing.tierCode) appliedTierCode = pricing.tierCode
    }

    // Rep-only per-line price override ("Custom price for this order" on
    // AddToCartButton) -- re-verified against isRep here, never trusted from
    // the client. An overridden line becomes its own final price and is
    // excluded from the tier-discount loop below (the discount doesn't
    // stack on top of a price the rep already set directly).
    const overriddenProductIds = new Set<string>()
    if (isRep) {
      for (const item of items) {
        const override = item.unitPriceOverrideCents
        if (typeof override !== 'number') continue
        const li = lineItems.find((l) => l.product_id === item.productId)
        if (!li) continue
        li.unit_price_cents = override
        li.line_total_cents = override * li.qty
        overriddenProductIds.add(li.product_id)
      }
    }

    // ── 2d. Tier/customer pricing, then an optional promo code ───────────────
    // lib/promotions.ts: per line the better of the tier price and the promo
    // price, never stacked; hand-priced (rep override) lines are left alone.
    // An unknown / expired / used-up code is refused so the buyer isn't
    // surprised; a valid code that saves nothing here is simply not applied.
    let promo: { id: string; code: string } | null = null
    let eligible: Set<string> | null = null
    let promoArg: Parameters<typeof priceWithPromotion>[1]['promo'] = null
    const rawPromo = (body as { promoCode?: unknown })?.promoCode
    if (typeof rawPromo === 'string' && rawPromo.trim()) {
      const loaded = await loadPromotion(db, rawPromo, lineItems.map((li) => li.product_id))
      if (!loaded.promotion) {
        return NextResponse.json({ error: `${loaded.reason} Remove the code to place your order.` }, { status: 400 })
      }
      promo = { id: loaded.promotion.id, code: loaded.promotion.code }
      promoArg = loaded.promotion
      eligible = loaded.eligible
    }
    const pricing = priceWithPromotion(
      lineItems.map((li) => ({ product_id: li.product_id, base_total_cents: li.line_total_cents, overridden: overriddenProductIds.has(li.product_id) })),
      { tierPct: discountPct, promo: promoArg, eligible: eligible ? (id) => eligible!.has(id) : undefined },
    )
    lineItems.forEach((li, i) => {
      li.line_total_cents = pricing.totals[i]
    })
    const promoApplied = !!promo && pricing.applied

    const subtotalCents = lineItems.reduce((sum, li) => sum + li.line_total_cents, 0)

    // ── 3. Enforce order minimum ─────────────────────────────────────────────
    const minErr = validateOrderMinimum(subtotalCents)
    if (minErr) {
      return NextResponse.json({ error: minErr.error }, { status: minErr.status })
    }

    // ── 3b. Estimated sales tax (lib/sales-tax.ts) ─────────────────────────────
    // Recomputed here, never taken from the cart. Only an estimate for the
    // quote: QuickBooks charges the real tax on the invoice. A resale
    // certificate counts only for a buyer signed in as the order email, or a
    // rep pricing for that customer, never for a guest's typed email.
    const certEmail = isRep || isSignedInAsOrderEmail(sessionUser?.email, orderEmail) ? orderEmail : null
    const taxInputs = await loadTaxInputs(db, certEmail)
    const tax = estimateSalesTax({ shipState: contact.shipState, subtotalCents, ...taxInputs, today: todayPacific() })

    // Take one use of the code atomically (usage cap). Given back below if the
    // order insert fails.
    if (promoApplied) {
      const { data: claimed, error: claimErr } = await db.rpc('claim_promotion_use', { p_id: promo!.id })
      if (claimErr) {
        console.error('[orders] promo claim failed:', claimErr.message)
        return NextResponse.json({ error: 'Could not apply the promo code. Please try again.' }, { status: 500 })
      }
      if (!claimed) {
        return NextResponse.json({ error: `${promo!.code} has reached its limit. Remove the code to place your order.` }, { status: 400 })
      }
    }

    // ── 4. Atomically insert order + items via RPC (Django atomic() pattern) ─
    const inserted = await insertOrder({
      db,
      contact,
      lineItems,
      subtotalCents,
      repUserId,
      appliedTierCode,
      appliedTierDiscountPercent: appliedTierCode ? discountPct : null,
    })
    if (!inserted.ok && promoApplied) {
      await db.rpc('release_promotion_use', { p_id: promo!.id })
    }
    if (inserted.ok) {
      // Recorded after the insert (insert_order's RPC signature is unchanged).
      // Best-effort: the prices are already final either way, and an order
      // without a saved estimate just shows no tax line.
      const { error: extrasErr } = await db
        .from('order_requests')
        .update({
          ...taxColumns(tax),
          ...(promoApplied ? { promo_code: promo!.code, promo_discount_cents: pricing.promoDiscountCents } : {}),
        })
        .eq('id', inserted.orderId)
      if (extrasErr) console.error('[orders] could not record promo/tax on order:', extrasErr.message)
    }
    if (!inserted.ok) {
      return NextResponse.json({ error: inserted.error }, { status: inserted.status })
    }
    const { orderId, referenceCode } = inserted

    // The column default (migration 0053) minted the order's link token. Read
    // it back for the confirmation email. If this fails, the email still goes
    // out with a plain link, which asks the customer to sign in.
    const { data: tokenRow } = await db
      .from('order_requests')
      .select('access_token')
      .eq('id', orderId)
      .maybeSingle()
    const accessToken: string | null = tokenRow?.access_token ?? null

    // ── 5. Side effects after commit (Django on_commit() pattern) ────────────
    // These run after the transaction has committed — never block the response
    // and never roll back the order on failure.
    void db
      .from('cart_sessions')
      .update({ order_placed_at: new Date().toISOString() })
      .eq('email', contact.email.trim())
      .is('order_placed_at', null)

    await Promise.allSettled([
      notifyReps({ referenceCode, contact, lineItems, subtotalCents, outOfStock, discountPct, tax: taxColumns(tax) }),
      notifyCustomer({ referenceCode, accessToken, contact, lineItems, subtotalCents, tax: taxColumns(tax) }),
      // Owner for follow-up (docs/ORDER-FOLLOW-UP-PLAN.md part 2). Catches its own errors.
      autoAssignOrder(db, orderId),
    ]).then((results) => {
      const labels = ['rep notification', 'customer confirmation', 'auto-assign']
      results.forEach((r, i) => {
        if (r.status === 'rejected') console.error(`[orders] ${labels[i]} failed (order still saved):`, r.reason)
      })
    })

    return NextResponse.json({ referenceCode, orderId })
  } catch (err) {
    console.error('[orders] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
