import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET /api/reps — public, unauthenticated (the checkout form's "Placed by
// (rep)" dropdown needs this before the buyer has any session). Returns only
// active rep account emails — same info already exposed via ?rep= links and
// the "CC sales rep" field, just listed instead of typed freehand.
export async function GET() {
  try {
    const db = getAdminClient()
    const { data, error } = await db.auth.admin.listUsers({ perPage: 200 })
    if (error) throw error

    const reps = (data?.users ?? [])
      .filter((u) => u.app_metadata?.role === 'rep' && (!u.banned_until || new Date(u.banned_until).getTime() < Date.now()))
      .map((u) => u.email)
      .filter((email): email is string => Boolean(email))
      .sort()

    return NextResponse.json({ reps })
  } catch (err) {
    console.error('[api/reps] error:', err)
    return NextResponse.json({ reps: [] })
  }
}
