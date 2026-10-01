import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { parseRequestedItems, sanitizeGreetingName } from '@/lib/cart-session-items'

export const dynamic = 'force-dynamic'

// Public and unauthenticated by design (guest checkout); see
// lib/cart-session-items.ts. Only {sku, qty} is taken from the caller. Names
// and prices are read from products, and only for products a shopper could
// actually see.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const email: unknown = body.email

    // Validate email
    if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Valid email is required.' }, { status: 400 })
    }

    const requested = parseRequestedItems(body.items)
    if (requested.length === 0) {
      return NextResponse.json({ error: 'Items must be a non-empty array.' }, { status: 400 })
    }

    const db = getAdminClient()

    const { data: products, error: productError } = await db
      .from('products')
      .select('sku, name, price_cents')
      .in('sku', requested.map((r) => r.sku))
      .eq('is_active', true)
      .eq('manually_hidden', false)
    if (productError) {
      console.error('[cart-session] product lookup failed:', productError.message)
      return NextResponse.json({ error: 'Could not save cart session.' }, { status: 500 })
    }

    const bySku = new Map((products ?? []).map((p) => [p.sku as string, p]))
    const items = requested.flatMap((r) => {
      const p = bySku.get(r.sku)
      return p ? [{ sku: r.sku, name: p.name as string, qty: r.qty, priceCents: p.price_cents as number }] : []
    })
    if (items.length === 0) {
      return NextResponse.json({ error: 'Items must be a non-empty array.' }, { status: 400 })
    }

    // Upsert: on conflict (email where order_placed_at IS NULL) update items/name/updated_at.
    // Supabase upsert with onConflict targets the unique index.
    const { error } = await db.from('cart_sessions').upsert(
      {
        email,
        name: sanitizeGreetingName(body.name),
        items,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'email',
        ignoreDuplicates: false,
      },
    )

    if (error) {
      console.error('[cart-session] upsert failed:', error.message)
      return NextResponse.json({ error: 'Could not save cart session.' }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[cart-session] unexpected error:', err)
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 })
  }
}
