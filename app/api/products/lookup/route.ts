import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// POST /api/products/lookup — { skus: string[] } → matching orderable products.
// Powers the Quick Order paste-a-list box. Only returns publicly visible
// products; unknown/hidden SKUs are simply absent so the client can report them.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    if (!Array.isArray(body.skus)) {
      return NextResponse.json({ error: 'skus must be an array' }, { status: 400 })
    }

    const skus = [...new Set(body.skus.map((s: unknown) => String(s).trim()).filter(Boolean))].slice(0, 200)
    if (skus.length === 0) return NextResponse.json({ products: [] })

    const { data, error } = await supabase
      .from('products')
      .select('id, sku, name, price_cents, image_url, stock_qty')
      .in('sku', skus)
      .eq('is_active', true)
      .eq('manually_hidden', false)
    if (error) throw error

    return NextResponse.json({ products: data ?? [] })
  } catch (err) {
    console.error('[products/lookup] error:', err)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
  }
}
