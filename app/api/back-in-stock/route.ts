import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { productId, email } = body ?? {}

    // Validate inputs
    if (!productId || typeof productId !== 'string' || productId.trim() === '') {
      return NextResponse.json({ ok: false }, { status: 200 })
    }
    if (!email || typeof email !== 'string' || !EMAIL_RE.test(email)) {
      return NextResponse.json({ ok: false }, { status: 200 })
    }

    const supabase = getAdminClient()

    // Verify product exists and is out of stock
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, stock_qty')
      .eq('id', productId.trim())
      .single()

    if (productError || !product) {
      return NextResponse.json({ ok: false }, { status: 200 })
    }

    if (product.stock_qty > 0) {
      return NextResponse.json({ ok: true, alreadyInStock: true }, { status: 200 })
    }

    // Upsert — ignore if already registered
    const { error: upsertError } = await supabase
      .from('back_in_stock_requests')
      .upsert(
        { product_id: productId.trim(), email: email.trim().toLowerCase() },
        { onConflict: 'product_id,email', ignoreDuplicates: true }
      )

    if (upsertError) {
      console.error('[back-in-stock] upsert error:', upsertError)
      return NextResponse.json({ ok: false }, { status: 200 })
    }

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (err) {
    console.error('[back-in-stock] unexpected error:', err)
    return NextResponse.json({ ok: false }, { status: 200 })
  }
}
