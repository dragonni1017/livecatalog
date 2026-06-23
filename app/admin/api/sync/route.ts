import { NextResponse } from 'next/server'
import { getErplyProducts, isConfigured, type ErplySyncProduct } from '@/lib/erply'
import { previewSync, syncToSupabase, type SyncProduct } from '@/lib/product-sync'

export const dynamic = 'force-dynamic'

// Admin Erply sync controls. Lives under /admin, so middleware.ts already gates
// this behind the admin auth cookie (no CRON_SECRET needed — that's for the
// public cron at /api/sync).

function isMockMode(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  return !url || url === 'your-supabase-url' || url.includes('placeholder')
}

function toSyncProducts(erply: ErplySyncProduct[]): SyncProduct[] {
  return erply.map((p) => ({
    sku: p.sku,
    barcode: p.barcode,
    name: p.name,
    price_cents: Math.round(p.price * 100),
    description: p.description || null,
    stock_qty: p.stockQty,
    image_url: p.imageUrl,
    is_active: p.isActive,
    category_name: p.categoryName,
  }))
}

// GET /admin/api/sync — dry-run preview of what an Erply sync would change.
// Read-only; never mutates. `configured` tells the UI whether this reflects real
// Erply data or the stub sample (in which case the preview is not meaningful).
export async function GET() {
  try {
    if (isMockMode()) return NextResponse.json({ configured: false, mock: true, preview: null })

    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()
    const products = toSyncProducts(await getErplyProducts())
    const preview = await previewSync(products, db)
    return NextResponse.json({ configured: isConfigured(), preview })
  } catch (err) {
    console.error('[admin/sync GET] preview failed:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Preview failed' }, { status: 500 })
  }
}

// POST /admin/api/sync — run a real Erply sync now (manual "Sync Now").
// Refuses to run unless Erply is configured: a stub-mode sync would deactivate
// the entire catalog (see /api/sync guard + cron-stub-wipe history).
export async function POST() {
  try {
    if (!isConfigured()) {
      return NextResponse.json(
        { ok: false, skipped: true, reason: 'Erply not configured — sync disabled to protect the catalog' },
        { status: 400 },
      )
    }
    if (isMockMode()) return NextResponse.json({ ok: true, mock: true })

    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()
    const products = toSyncProducts(await getErplyProducts())
    const result = await syncToSupabase(products, db)
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[admin/sync POST] run failed:', err)
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Sync failed' }, { status: 500 })
  }
}
