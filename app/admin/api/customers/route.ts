import { NextRequest, NextResponse } from 'next/server'

// This route lives under /admin, so middleware.ts already gates it behind the
// admin auth cookie — no extra auth check needed here.

function isMockMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return !url || url === 'your-supabase-url' || url.includes('placeholder')
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

// GET /admin/api/customers — return all customers ordered by company, name
export async function GET() {
  if (isMockMode()) {
    return NextResponse.json({ customers: [] })
  }

  try {
    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()
    const { data, error } = await db
      .from('customers')
      .select('*')
      .order('company')
      .order('name')

    if (error) throw error
    return NextResponse.json({ customers: data ?? [] })
  } catch (err) {
    console.error('[admin/customers GET] error:', err)
    return NextResponse.json({ error: 'Failed to fetch customers' }, { status: 500 })
  }
}

// POST /admin/api/customers — create a new customer
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { email, name, company, discount_percent, notes, price_tier_code } = body

    if (!email || typeof email !== 'string' || !isValidEmail(email)) {
      return NextResponse.json({ error: 'Valid email is required' }, { status: 400 })
    }

    const discount = discount_percent !== undefined ? Number(discount_percent) : 0
    if (isNaN(discount) || discount < 0 || discount > 100) {
      return NextResponse.json({ error: 'discount_percent must be between 0 and 100' }, { status: 400 })
    }

    if (isMockMode()) {
      return NextResponse.json({ customer: { id: 'mock', email, name, company, discount_percent: discount, notes, price_tier_code: price_tier_code || null } })
    }

    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()
    const { data, error } = await db
      .from('customers')
      .insert({
        email: email.trim().toLowerCase(),
        name: name ?? null,
        company: company ?? null,
        discount_percent: discount,
        notes: notes ?? null,
        price_tier_code: price_tier_code || null,
      })
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'A customer with that email already exists' }, { status: 409 })
      }
      if (error.code === '23503') {
        return NextResponse.json({ error: 'Invalid price tier selected' }, { status: 400 })
      }
      throw error
    }

    return NextResponse.json({ customer: data }, { status: 201 })
  } catch (err) {
    console.error('[admin/customers POST] error:', err)
    return NextResponse.json({ error: 'Failed to create customer' }, { status: 500 })
  }
}

// PATCH /admin/api/customers — update an existing customer
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, name, company, discount_percent, notes, price_tier_code } = body

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    if (discount_percent !== undefined) {
      const discount = Number(discount_percent)
      if (isNaN(discount) || discount < 0 || discount > 100) {
        return NextResponse.json({ error: 'discount_percent must be between 0 and 100' }, { status: 400 })
      }
    }

    if (isMockMode()) {
      return NextResponse.json({ ok: true, mock: true })
    }

    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (name !== undefined) patch.name = name
    if (company !== undefined) patch.company = company
    if (discount_percent !== undefined) patch.discount_percent = Number(discount_percent)
    if (notes !== undefined) patch.notes = notes
    if (price_tier_code !== undefined) patch.price_tier_code = price_tier_code || null

    const { error } = await db.from('customers').update(patch).eq('id', id)
    if (error) {
      if (error.code === '23503') {
        return NextResponse.json({ error: 'Invalid price tier selected' }, { status: 400 })
      }
      throw error
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/customers PATCH] error:', err)
    return NextResponse.json({ error: 'Failed to update customer' }, { status: 500 })
  }
}

// DELETE /admin/api/customers?id=... — hard delete a customer
export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'id query param is required' }, { status: 400 })
    }

    if (isMockMode()) {
      return NextResponse.json({ ok: true, mock: true })
    }

    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()
    const { error } = await db.from('customers').delete().eq('id', id)
    if (error) throw error

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/customers DELETE] error:', err)
    return NextResponse.json({ error: 'Failed to delete customer' }, { status: 500 })
  }
}
