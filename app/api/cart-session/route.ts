import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface CartItem {
  sku: string
  name: string
  qty: number
  priceCents: number
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const email: unknown = body.email
    const name: unknown = body.name
    const items: unknown = body.items

    // Validate email
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Valid email is required.' }, { status: 400 })
    }

    // Validate items
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Items must be a non-empty array.' }, { status: 400 })
    }

    const cleanItems: CartItem[] = items.filter(
      (i): i is CartItem =>
        typeof i === 'object' &&
        i !== null &&
        typeof i.sku === 'string' &&
        typeof i.name === 'string' &&
        typeof i.qty === 'number' &&
        typeof i.priceCents === 'number',
    )

    if (cleanItems.length === 0) {
      return NextResponse.json({ error: 'Items must be a non-empty array.' }, { status: 400 })
    }

    const db = getAdminClient()

    // Upsert: on conflict (email where order_placed_at IS NULL) update items/name/updated_at.
    // Supabase upsert with onConflict targets the unique index.
    const { error } = await db.from('cart_sessions').upsert(
      {
        email,
        name: typeof name === 'string' ? name : null,
        items: cleanItems,
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
