import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabase'
import { getActorEmail } from '@/lib/auth-server'
import { logAudit } from '@/lib/audit'
import {
  fetchReceivingCohort,
  parseSkuList,
  unhideBlocker,
  UNHIDE_BLOCKER_TEXT,
  type PricingRow,
} from '@/lib/needs-pricing'

export const dynamic = 'force-dynamic'

// POST { skus: string[] } -> { unhidden: string[], skipped: { sku, reason }[] }
//
// The "Ready to show" half of /admin/cleanup?issue=pricing: puts priced
// products from the receiving cohort on the storefront. Everything the
// screen showed is re-checked here, and the UPDATE itself is guarded by the
// same column conditions (active, priced, still hidden), so a product the
// sync re-zeroed or someone re-hid in the meantime is skipped, not shown.
// Cohort membership lives in another table and can't be part of the UPDATE's
// filter; it is re-read immediately before.
//
// Only ever sets manually_hidden=false. A $0 product must never go live --
// a visible $0 product is orderable for free (lib/order-submission.ts checks
// only is_active and manually_hidden).

interface ProductRow extends PricingRow {
  id: string
  sku: string
}

export async function POST(request: NextRequest) {
  try {
    const parsed = parseSkuList(await request.json().catch(() => null))
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const { skus } = parsed

    const db = getAdminClient()
    const cohort = await fetchReceivingCohort(db)
    const { data, error } = await db
      .from('products')
      .select('id, sku, is_active, manually_hidden, price_cents')
      .in('sku', skus)
    if (error) throw new Error(`Product lookup failed: ${error.message}`)

    const bySku = new Map<string, ProductRow[]>()
    for (const r of (data ?? []) as ProductRow[]) bySku.set(r.sku, [...(bySku.get(r.sku) ?? []), r])

    const unhidden: string[] = []
    const skipped: Array<{ sku: string; reason: string }> = []
    const actor = await getActorEmail()

    for (const sku of skus) {
      const rows = bySku.get(sku) ?? []
      if (rows.length === 0) {
        skipped.push({ sku, reason: 'not in the catalog' })
        continue
      }
      if (rows.length > 1) {
        skipped.push({ sku, reason: `${rows.length} catalog rows share this SKU` })
        continue
      }
      const row = rows[0]
      const blocker = unhideBlocker(row, cohort)
      if (blocker) {
        skipped.push({ sku, reason: UNHIDE_BLOCKER_TEXT[blocker] })
        continue
      }

      const { data: written, error: updateError } = await db
        .from('products')
        .update({ manually_hidden: false, updated_at: new Date().toISOString() })
        .eq('id', row.id)
        .eq('is_active', true)
        .eq('manually_hidden', true)
        .gt('price_cents', 0)
        .select('id')
      if (updateError) {
        skipped.push({ sku, reason: `update failed: ${updateError.message}` })
        continue
      }
      if (!written || written.length === 0) {
        skipped.push({ sku, reason: 'changed since it was checked (re-hidden, re-zeroed or deactivated)' })
        continue
      }

      unhidden.push(sku)
      await logAudit({
        action: 'product_unhidden',
        entity_type: 'product',
        entity_id: row.id,
        entity_label: sku,
        old_value: `hidden (price_cents ${row.price_cents})`,
        new_value: 'on storefront [cleanup: ready to show]',
        performed_by: actor,
      })
    }

    return NextResponse.json({ unhidden, skipped })
  } catch (err) {
    console.error('[admin/cleanup/unhide] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to unhide products.' },
      { status: 500 },
    )
  }
}
