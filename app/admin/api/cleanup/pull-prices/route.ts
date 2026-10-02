import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { getActorEmail } from '@/lib/auth-server'
import { logAudit } from '@/lib/audit'
import { getErplyProducts, isConfigured as isErplyConfigured, syncPriceCents } from '@/lib/erply'
import { parseSkuList, planPricePull, type CatalogPriceRow } from '@/lib/needs-pricing'

export const dynamic = 'force-dynamic'
// A full active-catalog read from Erply took ~5.5s on 2026-10-02 (3,164
// products, 200 per page). Same budget as the cron that does the same read.
export const maxDuration = 60

// POST { skus: string[] } ->
//   { updated: {sku, from, to}[], stillZeroInErply: string[], notInErply: string[],
//     skipped: {sku, reason}[], errors: {sku, error}[] }
//
// "Pull prices from Erply now" for /admin/cleanup?issue=pricing, so a price
// entered in Erply reaches the catalog without waiting for the 08:00 UTC
// cron. Prices are never SET here: Erply can't accept one over the API on
// this account, and the sync owns price_cents.
//
// Reads Erply exactly the way the cron does (getErplyProducts ->
// normalizeProduct -> syncPriceCents), so the value written is the one the
// next sync would write anyway. Only active catalog rows still at <= 0 are
// candidates, and each UPDATE is guarded on that, so this can never move a
// real price or race the cron into a different value. One UPDATE per
// product, price_cents + updated_at only -- never a bulk upsert (see the
// key-union rule in CLAUDE.md), never manually_hidden: unhiding stays a
// deliberate click in the "Ready to show" list.
//
// Refuses where Erply isn't configured: getSessionKey hands back a stub key
// and getErplyProducts returns demo data, which would read as "not in Erply"
// for everything.

export async function POST(request: NextRequest) {
  try {
    if (!isErplyConfigured()) {
      return NextResponse.json({ error: 'Erply is not configured on this deployment.' }, { status: 503 })
    }

    const parsed = parseSkuList(await request.json().catch(() => null))
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const { skus } = parsed

    const db = getAdminClient()
    const { data, error } = await db
      .from('products')
      .select('id, sku, is_active, price_cents')
      .in('sku', skus)
    if (error) throw new Error(`Product lookup failed: ${error.message}`)
    const catalog = (data ?? []) as CatalogPriceRow[]

    const erply = (await getErplyProducts()).map((p) => ({ sku: p.sku, price_cents: syncPriceCents(p) }))
    const plan = planPricePull(skus, catalog, erply)

    const updated: Array<{ sku: string; from: number; to: number }> = []
    const skipped = [...plan.skipped]
    const errors: Array<{ sku: string; error: string }> = []
    const actor = await getActorEmail()

    for (const u of plan.updates) {
      const { data: written, error: updateError } = await db
        .from('products')
        .update({ price_cents: u.to, updated_at: new Date().toISOString() })
        .eq('id', u.id)
        .eq('is_active', true)
        .lte('price_cents', 0)
        .select('id')
      if (updateError) {
        errors.push({ sku: u.sku, error: updateError.message })
        continue
      }
      if (!written || written.length === 0) {
        skipped.push({ sku: u.sku, reason: 'priced or deactivated since it was read' })
        continue
      }
      updated.push({ sku: u.sku, from: u.from, to: u.to })
      await logAudit({
        action: 'product_price_pulled_from_erply',
        entity_type: 'product',
        entity_id: u.id,
        entity_label: u.sku,
        old_value: String(u.from),
        new_value: `${u.to} [price_cents, from Erply via cleanup]`,
        performed_by: actor,
      })
    }

    return NextResponse.json({
      updated,
      stillZeroInErply: plan.stillZeroInErply,
      notInErply: plan.notInErply,
      skipped,
      errors,
    })
  } catch (err) {
    console.error('[admin/cleanup/pull-prices] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to pull prices from Erply.' },
      { status: 500 },
    )
  }
}
