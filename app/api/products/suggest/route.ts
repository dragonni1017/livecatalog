import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const qRaw = searchParams.get('q') ?? ''
  // Strip chars that would break PostgREST's filter syntax (same as the
  // main catalog search in app/(catalog)/page.tsx).
  const q = qRaw.replace(/[%,()]/g, '')

  if (q.length < 2) {
    return NextResponse.json({ results: [] }, { headers: { 'Cache-Control': 'no-store' } })
  }

  const { getAdminClient } = await import('@/lib/supabase')
  const db = getAdminClient()

  const { data, error } = await db
    .from('products')
    .select('id, sku, name, price_cents, image_url, category:categories(name)')
    .or(`name.ilike.%${q}%,sku.ilike.%${q}%,barcode.ilike.%${q}%`)
    .eq('is_active', true)
    .limit(6)

  if (error) {
    console.error('[suggest] query failed:', error.message)
    return NextResponse.json({ results: [] }, { headers: { 'Cache-Control': 'no-store' } })
  }

  const results = (data ?? []).map((p: {
    id: string
    sku: string
    name: string
    price_cents: number
    image_url: string | null
    category: { name: string }[] | { name: string } | null
  }) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    price_cents: p.price_cents,
    image_url: p.image_url,
    category_name: Array.isArray(p.category)
      ? p.category[0]?.name ?? null
      : (p.category as { name: string } | null)?.name ?? null,
  }))

  return NextResponse.json({ results }, { headers: { 'Cache-Control': 'no-store' } })
}
