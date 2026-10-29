import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'

// GET /admin/api/price-review/erply: CSV of every product whose price is
// still held (products.held_price_cents, 0068), i.e. every price that still
// has to be typed into Erply. Covers prices held by the review screen and by
// earlier one-off runs alike. A row drops off by itself once Erply matches.
// Lives under /admin, so middleware.ts requires the admin login.

export const dynamic = 'force-dynamic'

const csv = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

export async function GET() {
  const db = getAdminClient()
  const { data, error } = await db
    .from('products')
    .select('sku, name, held_price_cents')
    .not('held_price_cents', 'is', null)
    .order('sku')
  if (error) return NextResponse.json({ error: 'Failed to load' }, { status: 500 })

  const lines = ['SKU,Name,Enter this price in Erply']
  for (const p of data ?? []) lines.push([p.sku, p.name, (p.held_price_cents / 100).toFixed(2)].map((v) => csv(String(v))).join(','))
  const day = new Date().toISOString().slice(0, 10)
  return new NextResponse(lines.join('\n') + '\n', {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="prices-to-enter-in-erply-${day}.csv"`,
    },
  })
}
