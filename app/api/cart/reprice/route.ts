import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { getSessionUser } from '@/lib/auth-server'
import { buildLineItems } from '@/lib/order-submission'
import { applyTierDiscount } from '@/lib/order-rules'
import { TIER_COOKIE } from '@/lib/rep-tier-shared'
import { resolveCustomerPricing } from '@/lib/customer-pricing'
import { loadPromotion, priceWithPromotion } from '@/lib/promotions'

export const dynamic = 'force-dynamic'

interface IncomingItem {
  productId: string
  qty: number
}

// POST /api/cart/reprice — { items: [{productId, qty}] } -> current
// authoritative unit price per productId, with the CURRENT session's
// rep-tier discount (if any) applied.
//
// The cart's stored priceCents is a snapshot frozen at add-time (see
// lib/cart-context.tsx) -- nothing before this re-synced it, so a rep who
// added items at a discount and then logged out kept seeing that discounted
// price in the cart indefinitely (a refresh of the product listing fixed
// itself via useTierDiscount(), but the cart's own frozen numbers never
// did). The real order was never at risk -- app/api/orders/route.ts
// independently re-derives price + discount from the verified session at
// submit time, ignoring whatever the client cart shows -- but showing a
// stale discounted price after logout is confusing and worth keeping
// honest. Called on cart mount + pageshow, same pattern as TierSwitcher.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const items: IncomingItem[] = Array.isArray(body.items)
      ? body.items.filter(
          (i: unknown): i is IncomingItem =>
            !!i &&
            typeof (i as IncomingItem).productId === 'string' &&
            Number.isFinite((i as IncomingItem).qty) &&
            (i as IncomingItem).qty > 0,
        )
      : []
    if (items.length === 0) return NextResponse.json({ prices: {} })

    const db = getAdminClient()
    const built = await buildLineItems(db, items)
    if ('error' in built) {
      return NextResponse.json({ error: built.error }, { status: 500 })
    }

    let discountPct = 0
    const sessionUser = await getSessionUser()
    if (sessionUser?.app_metadata?.role === 'rep') {
      const tierCode = request.cookies.get(TIER_COOKIE)?.value
      if (tierCode) {
        const { data: tier } = await db
          .from('price_tiers')
          .select('discount_percent, active')
          .eq('code', tierCode)
          .maybeSingle()
        if (tier?.active) discountPct = Number(tier.discount_percent)
      }
    } else if (sessionUser?.email) {
      // A logged-in customer's own pricing (assigned tier, else flat
      // discount) — the same helper as the real order charge in
      // app/api/orders/route.ts, never the client cookie.
      discountPct = (await resolveCustomerPricing(db, sessionUser.email)).discountPct
    }

    const prices: Record<string, number> = {}
    for (const li of built.lineItems) {
      prices[li.product_id] = applyTierDiscount(li.unit_price_cents, discountPct)
    }

    // Optional promo code: the same better-of rule and function as the real
    // charge (lib/promotions.ts), reported as a separate saving so the cart's
    // per-item prices stay as they are. `customPrice` lines (a rep's hand
    // price) are excluded here for display; the order route re-verifies.
    let promo: { code: string; applied: boolean; discountCents: number; percentOff?: number; reason?: string } | undefined
    if (typeof body.promoCode === 'string' && body.promoCode.trim()) {
      const custom = new Set(
        (Array.isArray(body.items) ? body.items : [])
          .filter((i: { customPrice?: unknown; productId?: unknown }) => i?.customPrice === true && typeof i.productId === 'string')
          .map((i: { productId: string }) => i.productId),
      )
      const loaded = await loadPromotion(db, body.promoCode, built.lineItems.map((li) => li.product_id))
      const code = String(body.promoCode).trim().toUpperCase()
      if (!loaded.promotion) {
        promo = { code, applied: false, discountCents: 0, reason: loaded.reason }
      } else {
        const r = priceWithPromotion(
          built.lineItems.map((li) => ({ product_id: li.product_id, base_total_cents: li.line_total_cents, overridden: custom.has(li.product_id) })),
          { tierPct: discountPct, promo: loaded.promotion, eligible: (id) => loaded.eligible.has(id) },
        )
        promo = {
          code: loaded.promotion.code,
          applied: r.applied,
          discountCents: r.promoDiscountCents,
          percentOff: Number(loaded.promotion.percent_off),
          reason: r.reason,
        }
      }
    }
    // Asked about but not priced: inactive, hidden or $0 (buildLineItems drops
    // them, and the real order will too). The cart marks these lines rather
    // than letting them vanish from the order unannounced.
    const unavailable = [...new Set(items.map((i) => i.productId))].filter((id) => !(id in prices))
    return NextResponse.json(promo ? { prices, unavailable, promo } : { prices, unavailable })
  } catch (err) {
    console.error('[cart/reprice] error:', err)
    return NextResponse.json({ error: 'Reprice failed' }, { status: 500 })
  }
}
