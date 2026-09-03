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
import { getErplyProducts, getErplyStock, isConfigured } from '@/lib/erply'
import { syncToSupabase, syncStockFromErply, type SyncProduct } from '@/lib/product-sync'
import { resolveErplyCategoryAlias } from '@/lib/erply-category-aliases'
import type { ImportResult } from '@/lib/types'

// Default Vercel function timeout (10s) isn't enough for the batched
// adjust_stock() calls a full-catalog stock sync makes (see
// syncStockFromErply in lib/product-sync.ts). 60s is the safe max for both
// Hobby and Pro plans without checking which tier this project is on —
// raise it (Pro allows up to 300s) if a real run still times out against
// the full ~3,000-product catalog.
export const maxDuration = 60

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

  // Guard: never run the sync in stub mode. getErplyProducts() returns only a
  // handful of demo products when Erply isn't configured, and syncToSupabase
  // deactivates every product NOT in the incoming batch — which would wipe the
  // entire live catalog. Skip entirely until real Erply credentials are set.
  if (!isConfigured()) {
    console.warn('[sync] Erply not configured — skipping product sync to avoid deactivating the catalog')
    // Still run the daily low-stock check against current DB stock — it's
    // decoupled from the (destructive, disabled) product sync.
    let lowStock: unknown = { skipped: 'not run' }
    let abandonedCarts: unknown = { skipped: 'not run' }
    try {
      const { getAdminClient } = await import('@/lib/supabase')
      const { checkLowStockAndNotify } = await import('@/lib/low-stock-alert')
      const { checkAbandonedCarts } = await import('@/lib/abandoned-cart')
      const db = getAdminClient()
      lowStock = await checkLowStockAndNotify(db)
      try {
        await checkAbandonedCarts(db)
        abandonedCarts = { ok: true }
      } catch (err) {
        console.error('[sync] abandoned-cart check failed (non-fatal):', err)
        abandonedCarts = { error: String(err) }
      }
    } catch (err) {
      console.error('[sync] low-stock check failed (non-fatal):', err)
    }
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: 'Erply not configured; product sync skipped to protect the catalog',
      lowStock,
      abandonedCarts,
      syncedAt: new Date().toISOString(),
    })
  }

  const startedAt = Date.now()

  try {
    // 1. Pull products from Erply
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
      // Erply's raw groups are more granular than this catalog's
      // consolidated categories (e.g. "Tumblers" -> "Drinkware & Cups") --
      // see lib/erply-category-aliases.ts for the full mapping and why.
      category_name: resolveErplyCategoryAlias(p.categoryName),
    }))

    // 3. Upsert into Supabase
    const { getAdminClient } = await import('@/lib/supabase')
    const db = getAdminClient()
    // Erply's images aren't accessible yet and its inventory reads 0 across the
    // board (see docs/ERPLY-INTEGRATION-STATUS-HANDOFF.md) — don't let a real
    // sync null out working Cloudinary images or zero out real stock counts.
    // 'category' is skipped too: several categories are deliberate manual
    // carve-outs the alias map above can't fully capture (see
    // lib/erply-category-aliases.ts) — only set on first insert, never
    // reassigned on update, so this cron can't flatten curated categories
    // back on a schedule.
    const result: ImportResult = await syncToSupabase(products, db, {
      skipFields: ['image_url', 'stock_qty', 'category'],
    })

    // 3b. Stock sync — separate from the upsert above, since blindly
    // overwriting stock_qty would clobber any order-fulfillment decrement
    // or manual admin edit made since the last run. See syncStockFromErply
    // in lib/product-sync.ts for the delta-anchored approach that avoids
    // that. Warehouse 1 ("L&Y USA") only — Dragon decided 2026-09-03 that
    // warehouse 2 ("Store LA") may be retail/in-store-only stock that
    // shouldn't be sold to wholesale catalog customers.
    let stockSync: unknown = { skipped: 'not run' }
    try {
      const erplyStock = await getErplyStock(1)
      stockSync = await syncStockFromErply(erplyStock, db)
    } catch (err) {
      console.error('[sync] stock sync failed (non-fatal to the rest of this run):', err)
      stockSync = { error: err instanceof Error ? err.message : String(err) }
    }

    // 4. Run daily auxiliary checks (low-stock + abandoned carts)
    let lowStock: unknown = { skipped: 'not run' }
    let abandonedCarts: unknown = { skipped: 'not run' }
    try {
      const { checkLowStockAndNotify } = await import('@/lib/low-stock-alert')
      lowStock = await checkLowStockAndNotify(db)
    } catch (err) {
      console.error('[sync] low-stock check failed (non-fatal):', err)
    }
    try {
      const { checkAbandonedCarts } = await import('@/lib/abandoned-cart')
      await checkAbandonedCarts(db)
      abandonedCarts = { ok: true }
    } catch (err) {
      console.error('[sync] abandoned-cart check failed (non-fatal):', err)
      abandonedCarts = { error: String(err) }
    }

    const elapsed = Date.now() - startedAt
    console.log(`[sync] Done in ${elapsed}ms — inserted:${result.inserted} updated:${result.updated} deactivated:${result.deactivated} errors:${result.errors.length} stockSync:${JSON.stringify(stockSync)}`)

    return NextResponse.json({
      ok: true,
      syncedAt: new Date().toISOString(),
      durationMs: elapsed,
      lowStock,
      abandonedCarts,
      stockSync,
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
