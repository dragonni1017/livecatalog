import { NextRequest, NextResponse } from 'next/server'
import { searchWords, wordOrFilter } from '@/lib/search-terms'

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

  // Per word, plural-tolerant, like the grid search: "floral boxes" finds
  // "Box, Floral".
  let query = db
    .from('products')
    .select('id, sku, name, price_cents, image_url, category:categories!products_category_id_fkey(name)')
    .eq('is_active', true)
    .eq('manually_hidden', false)
  for (const word of searchWords(q)) query = query.or(wordOrFilter(word, ['name', 'sku', 'barcode']))
  const { data, error } = await query.limit(6)

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
