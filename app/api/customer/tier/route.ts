import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { getSessionUser } from '@/lib/auth-server'

export const dynamic = 'force-dynamic'

// GET /api/customer/tier — display-only lookup of the CURRENT logged-in
// customer's assigned price tier (customers.price_tier_code, set via
// /admin/customers), keyed by their verified session email. Used by
// TierSwitcher to auto-apply a customer's own pricing while browsing, via
// the same TIER_COOKIE mechanism reps use — but the real charge at checkout
// (app/api/orders/route.ts) independently re-derives the tier from the DB
// by the order's own email, never trusts this route's response or the
// cookie it feeds. Returns { tier: null } for anyone not logged in, or
// logged in with no tier assigned — never another customer's data.
export async function GET() {
  const sessionUser = await getSessionUser()
  if (!sessionUser?.email) return NextResponse.json({ tier: null })

  const db = getAdminClient()
  const { data: customer } = await db
    .from('customers')
    .select('price_tier_code')
    .eq('email', sessionUser.email.trim().toLowerCase())
    .maybeSingle()

  if (!customer?.price_tier_code) return NextResponse.json({ tier: null })

  const { data: tier } = await db
    .from('price_tiers')
    .select('code, label, active')
    .eq('code', customer.price_tier_code)
    .maybeSingle()

  if (!tier?.active) return NextResponse.json({ tier: null })

  return NextResponse.json({ tier: { code: tier.code, label: tier.label } })
}
