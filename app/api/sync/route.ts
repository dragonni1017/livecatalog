/**
 * GET /api/sync
 *
 * Called by Vercel Cron every 30 minutes.  Pulls the full product + inventory
 * list from Erply and upserts it into Supabase.
 *
 * Security: requires  Authorization: Bearer {CRON_SECRET}  header.
 * Vercel Cron sends this automatically when CRON_SECRET is set in env vars.
 *
 * Stub mode: works without Erply credentials — returns demo data so the
 * cron infrastructure can be tested before Erply is configured.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getErplyProducts } from '@/lib/erply'
import { syncToSupabase, type SyncProduct } from '@/lib/product-sync'
import type { ImportResult } from '@/lib/types'

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.warn('[sync] CRON_SECRET not set — endpoint is unprotected')
    return true  // allow through in dev; set CRON_SECRET in production
  }
  return request.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()

  try {
    // 1. Pull products from Erply (or stub data if not configured)
    const erplyProducts = await getErplyProducts()

    // 2. Map Erply fields → our DB schema
    const products: SyncProduct[] = erplyProducts.map((p) => ({
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

    // 3. Upsert into Supabase
    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()
    const result: ImportResult = await syncToSupabase(products, db)

    const elapsed = Date.now() - startedAt
    console.log(`[sync] Done in ${elapsed}ms — inserted:${result.inserted} updated:${result.updated} deactivated:${result.deactivated} errors:${result.errors.length}`)

    return NextResponse.json({
      ok: true,
      syncedAt: new Date().toISOString(),
      durationMs: elapsed,
      ...result,
    })
  } catch (err) {
    console.error('[sync] Failed:', err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    )
  }
}
