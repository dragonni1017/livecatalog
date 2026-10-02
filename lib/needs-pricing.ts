/**
 * The "Needs pricing" tab of /admin/cleanup.
 *
 * Prices are NOT set in the catalog (Dragon, 2026-10-02). Erply cannot accept
 * a price over the API on this account, and the daily Erply sync owns
 * products.price_cents. This module only decides which products belong in
 * the two lists and what a "pull prices now" run would write. It is pure so
 * the page, both routes and the tests can't disagree.
 */

import type { getAdminClient } from '@/lib/supabase'

type Db = ReturnType<typeof getAdminClient>

/** Most SKUs one request may carry. Today's lists are ~100 rows. */
export const MAX_SKUS_PER_REQUEST = 200

export interface CohortLine {
  sku: string | null
  erply_created_product_id: string | number | null
}

/**
 * The receiving cohort: SKUs this catalog created in Erply from a received
 * container (shipment_lines.erply_created_product_id is set). Upper-cased,
 * because supplier sheets and Erply don't agree on case.
 *
 * Same rule as scripts/zero-price-visibility.mjs --unhide. It is what keeps
 * "priced and hidden" from meaning "should be shown": thousands of priced
 * products are hidden on purpose and must stay hidden.
 */
export function buildReceivingCohort(lines: CohortLine[]): Set<string> {
  const out = new Set<string>()
  for (const l of lines) {
    if (l.erply_created_product_id == null || l.erply_created_product_id === '') continue
    const sku = String(l.sku ?? '').trim().toUpperCase()
    if (sku) out.add(sku)
  }
  return out
}

/**
 * Reads the cohort live. Ordered by the primary key so range() paging is
 * stable (non-unique sorts duplicate/drop rows across pages).
 */
export async function fetchReceivingCohort(db: Db): Promise<Set<string>> {
  const lines: CohortLine[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from('shipment_lines')
      .select('sku, erply_created_product_id')
      .not('erply_created_product_id', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + 999)
    if (error) throw new Error(`Receiving cohort lookup failed: ${error.message}`)
    const batch = (data ?? []) as CohortLine[]
    lines.push(...batch)
    if (batch.length < 1000) break
  }
  return buildReceivingCohort(lines)
}

export interface PricingRow {
  sku: string | null
  is_active: boolean
  manually_hidden: boolean | null
  price_cents: number | null
}

export type UnhideBlocker = 'not_in_cohort' | 'inactive' | 'not_priced' | 'not_hidden'

/**
 * Why a product can't be unhidden from this tab, or null when it can.
 * The unhide route re-runs this server-side and guards its UPDATE with the
 * same column conditions.
 */
export function unhideBlocker(row: PricingRow, cohort: Set<string>): UnhideBlocker | null {
  if (!cohort.has(String(row.sku ?? '').trim().toUpperCase())) return 'not_in_cohort'
  if (!row.is_active) return 'inactive'
  if (!((row.price_cents ?? 0) > 0)) return 'not_priced'
  if (row.manually_hidden !== true) return 'not_hidden'
  return null
}

export const UNHIDE_BLOCKER_TEXT: Record<UnhideBlocker, string> = {
  not_in_cohort: 'not a product created by receiving, so it is hidden by choice',
  inactive: 'inactive in the catalog',
  not_priced: 'still has no price',
  not_hidden: 'already on the storefront',
}

/** "Ready to show": priced, still hidden, active, and in the receiving cohort. */
export function isReadyToShow(row: PricingRow, cohort: Set<string>): boolean {
  return unhideBlocker(row, cohort) === null
}

/** "Price in Erply": active with no usable price. */
export function needsErplyPrice(row: PricingRow): boolean {
  return row.is_active && (row.price_cents ?? 0) <= 0
}

/**
 * Validates a `{ skus }` request body: an array of non-empty strings, at most
 * MAX_SKUS_PER_REQUEST after trimming and de-duplicating. Case is kept,
 * because products.sku matching is exact everywhere the sync writes.
 */
export function parseSkuList(body: unknown): { skus: string[] } | { error: string } {
  const raw = (body as { skus?: unknown } | null)?.skus
  if (!Array.isArray(raw)) return { error: 'skus must be an array' }
  const skus = [...new Set(raw.filter((s): s is string => typeof s === 'string').map((s) => s.trim()).filter(Boolean))]
  if (skus.length === 0) return { error: 'No SKUs given' }
  if (skus.length > MAX_SKUS_PER_REQUEST) {
    return { error: `At most ${MAX_SKUS_PER_REQUEST} SKUs per request (got ${skus.length})` }
  }
  return { skus }
}

// ── Pull prices from Erply ────────────────────────────────────────────────────

export interface CatalogPriceRow {
  id: string
  sku: string
  is_active: boolean
  price_cents: number | null
}

export interface ErplyPriceRow {
  sku: string
  /** Already converted with lib/erply.ts syncPriceCents -- the sync's own formula. */
  price_cents: number
}

export interface PlannedPriceUpdate {
  id: string
  sku: string
  from: number
  to: number
}

export interface PricePullPlan {
  updates: PlannedPriceUpdate[]
  /**
   * Found in Erply, still at 0 there: it hasn't been priced yet. This is the
   * "unchanged" case -- only unpriced catalog rows are candidates, so any
   * non-zero Erply price differs from the catalog's.
   */
  stillZeroInErply: string[]
  /** Not among Erply's active products (the same set the daily sync reads). */
  notInErply: string[]
  /** Not written for a reason worth reading (duplicate code, case mismatch, …). */
  skipped: Array<{ sku: string; reason: string }>
}

/**
 * What a pull would write. Only rows that are active and still unpriced in
 * the catalog are candidates; anything already priced is left to the daily
 * sync, so this button can never move a real price. Never touches
 * visibility -- unhiding stays a deliberate click.
 *
 * `requested` is the list the admin sent; rows missing from `catalog` are
 * reported rather than silently dropped.
 */
export function planPricePull(
  requested: string[],
  catalog: CatalogPriceRow[],
  erply: ErplyPriceRow[],
): PricePullPlan {
  const plan: PricePullPlan = { updates: [], stillZeroInErply: [], notInErply: [], skipped: [] }

  const catalogBySku = new Map(catalog.map((r) => [r.sku, r]))
  const erplyBySku = new Map<string, ErplyPriceRow[]>()
  const erplyByUpper = new Map<string, string[]>()
  for (const e of erply) {
    erplyBySku.set(e.sku, [...(erplyBySku.get(e.sku) ?? []), e])
    const up = e.sku.toUpperCase()
    erplyByUpper.set(up, [...(erplyByUpper.get(up) ?? []), e.sku])
  }

  for (const sku of requested) {
    const row = catalogBySku.get(sku)
    if (!row) {
      plan.skipped.push({ sku, reason: 'not in the catalog' })
      continue
    }
    if (!row.is_active) {
      plan.skipped.push({ sku, reason: 'inactive in the catalog' })
      continue
    }
    const current = row.price_cents ?? 0
    if (current > 0) {
      plan.skipped.push({ sku, reason: 'already priced in the catalog; the daily sync owns changes' })
      continue
    }

    const matches = erplyBySku.get(sku) ?? []
    if (matches.length === 0) {
      // The sync matches on the exact SKU, so a case-only match would not be
      // carried across by it either. Say so rather than calling it missing.
      const caseOnly = (erplyByUpper.get(sku.toUpperCase()) ?? []).filter((s) => s !== sku)
      if (caseOnly.length > 0) {
        plan.skipped.push({ sku, reason: `Erply has it as ${caseOnly.join(', ')} (case differs)` })
      } else {
        plan.notInErply.push(sku)
      }
      continue
    }
    if (matches.length > 1) {
      // Erply's uniqueness check can be beaten by a fast double-submit
      // (F288132, 2026-09-23). Two records means two possible prices.
      const prices = [...new Set(matches.map((m) => m.price_cents))]
      if (prices.length > 1) {
        plan.skipped.push({ sku, reason: `${matches.length} Erply products share this code with different prices` })
        continue
      }
    }

    const to = matches[0].price_cents
    if (!(to > 0)) plan.stillZeroInErply.push(sku)
    else plan.updates.push({ id: row.id, sku, from: current, to })
  }

  return plan
}
