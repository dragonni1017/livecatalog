import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// This route lives under /admin, so middleware.ts already gates it behind
// the admin auth cookie — no extra auth check needed here.

// GET ?q=... — search the pulled QuickBooks customer list by name/company/
// email, for the admin UI's "link to this QuickBooks customer" picker.
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q')?.trim() ?? ''
  const db = getAdminClient()

  let query = db
    .from('qb_customer_directory')
    .select('qb_customer_list_id, full_name, company_name, email, phone')
    .order('full_name')
    .limit(25)

  if (q) {
    const like = `%${q}%`
    query = query.or(`full_name.ilike.${like},company_name.ilike.${like},email.ilike.${like}`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ customers: data ?? [] })
}
