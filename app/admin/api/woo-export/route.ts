import { NextRequest, NextResponse } from 'next/server'
import { buildExport, toCsv, wooHeader } from '@/lib/woo-export'
import { loadExportData } from '@/lib/woo-export-load'

// Lives under /admin, so middleware.ts already requires the admin login.
//
// GET /admin/api/woo-export?file=ready|almost[&images=1][&categories=1]
//   ready   WooCommerce product-import CSV of the catalog's ready products
//   almost  what each other active product is missing
// Read-only (lib/woo-export.ts says what goes in and why).

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const file = url.searchParams.get('file')
  if (file !== 'ready' && file !== 'almost') return NextResponse.json({ error: 'file must be ready or almost' }, { status: 400 })
  const opts = { images: url.searchParams.get('images') === '1', categories: url.searchParams.get('categories') === '1' }

  try {
    const { getAdminClient } = await import('@/lib/supabase')
    const { products, categoryOf } = await loadExportData(getAdminClient())
    const { ready, almost } = buildExport(products, categoryOf, opts)
    const date = new Date().toISOString().slice(0, 10)
    const csv =
      file === 'ready'
        ? toCsv(wooHeader(opts), ready)
        : toCsv(['SKU', 'Name', 'Missing', 'Stock'], almost.map((a) => [a.sku, a.name, a.missing.join(', '), a.stock]))
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="woocommerce-${file === 'ready' ? 'ready' : 'almost-ready'}-${date}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[admin/api/woo-export] error:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Export failed' }, { status: 500 })
  }
}
