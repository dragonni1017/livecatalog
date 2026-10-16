import type { getAdminClient } from '@/lib/supabase'
import { applyTierDiscount, formatPriceCents } from '@/lib/order-rules'
import { todayPacific } from '@/lib/collections'

// Promo codes (migration 0064). One rule, used by the cart preview
// (/api/cart/reprice) and the actual charge (/api/orders):
//
//   per line: final = min(tier/customer price, promo price) — never stacked
//
// The promo price is percent_off from the line's catalog price (after volume
// breaks), rounded like every other discount (applyTierDiscount). Lines a rep
// priced by hand, and lines outside the code's collection/category, keep their
// tier price. The minimum order compares against the subtotal before the code.

export interface Promotion {
  id: string
  code: string
  name: string
  percent_off: number | string
  is_active: boolean
  starts_on: string | null
  ends_on: string | null
  scope_kind: 'all' | 'collection' | 'category'
  scope_collection_id: string | null
  scope_category_id: string | null
  min_subtotal_cents: number | null
  max_uses: number | null
  times_used: number
}

export const PROMOTION_FIELDS =
  'id, code, name, percent_off, is_active, starts_on, ends_on, scope_kind, scope_collection_id, scope_category_id, min_subtotal_cents, max_uses, times_used'

/** "holiday10 " → "HOLIDAY10"; anything that can't be a code → null. */
export function normalizePromoCode(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const code = input.trim().toUpperCase()
  return /^[A-Z0-9_-]{3,32}$/.test(code) ? code : null
}

/** Can this code be used today at all (before looking at the cart)? */
export function promotionStatus(p: Promotion, today: string): { ok: true } | { ok: false; reason: string } {
  if (!p.is_active) return { ok: false, reason: `${p.code} isn't active.` }
  if (p.starts_on && today < p.starts_on) return { ok: false, reason: `${p.code} starts ${p.starts_on}.` }
  if (p.ends_on && today > p.ends_on) return { ok: false, reason: `${p.code} has expired.` }
  if (p.max_uses != null && p.times_used >= p.max_uses) return { ok: false, reason: `${p.code} has reached its limit.` }
  return { ok: true }
}

export interface PricedLine {
  product_id: string
  /** Catalog price for this qty (after volume breaks), before any discount. */
  base_total_cents: number
  /** True when a rep set this line's price by hand. */
  overridden?: boolean
}

export interface PromoPricing {
  /** Final line totals, same order as the input. */
  totals: number[]
  /** Subtotal at tier/customer pricing, before the code. */
  subtotalBeforeCents: number
  /** Extra savings the code adds over tier/customer pricing (0 = no effect). */
  promoDiscountCents: number
  applied: boolean
  reason?: string
}

/** Pure: tier pricing, then the better-of comparison with the code. */
export function priceWithPromotion(
  lines: PricedLine[],
  opts: { tierPct: number; promo?: Pick<Promotion, 'code' | 'percent_off' | 'min_subtotal_cents'> | null; eligible?: (productId: string) => boolean },
): PromoPricing {
  // Same condition the order route always used: only a positive tier discounts.
  const tierTotals = lines.map((l) => (l.overridden || !(opts.tierPct > 0) ? l.base_total_cents : applyTierDiscount(l.base_total_cents, opts.tierPct)))
  const subtotalBeforeCents = tierTotals.reduce((a, b) => a + b, 0)
  const promo = opts.promo
  if (!promo) return { totals: tierTotals, subtotalBeforeCents, promoDiscountCents: 0, applied: false }

  if (promo.min_subtotal_cents != null && subtotalBeforeCents < promo.min_subtotal_cents) {
    return {
      totals: tierTotals,
      subtotalBeforeCents,
      promoDiscountCents: 0,
      applied: false,
      reason: `${promo.code} needs an order of ${formatPriceCents(promo.min_subtotal_cents)} or more.`,
    }
  }

  const pct = Number(promo.percent_off)
  const totals = lines.map((l, i) => {
    if (l.overridden || (opts.eligible && !opts.eligible(l.product_id))) return tierTotals[i]
    return Math.min(tierTotals[i], applyTierDiscount(l.base_total_cents, pct))
  })
  const promoDiscountCents = tierTotals.reduce((sum, t, i) => sum + (t - totals[i]), 0)
  if (promoDiscountCents <= 0) {
    const anyEligible = lines.some((l) => !l.overridden && (!opts.eligible || opts.eligible(l.product_id)))
    return {
      totals: tierTotals,
      subtotalBeforeCents,
      promoDiscountCents: 0,
      applied: false,
      reason: anyEligible ? `Your pricing is already better than ${promo.code}.` : `${promo.code} doesn't apply to anything in your cart.`,
    }
  }
  return { totals, subtotalBeforeCents, promoDiscountCents, applied: true }
}

type Db = ReturnType<typeof getAdminClient>

/**
 * Loads a code and which of these products it covers. `promotion: null` with a
 * reason when it's unknown or unusable today.
 */
export async function loadPromotion(
  db: Db,
  rawCode: unknown,
  productIds: string[],
  today: string = todayPacific(),
): Promise<{ promotion: Promotion; eligible: Set<string> } | { promotion: null; reason: string }> {
  const code = normalizePromoCode(rawCode)
  if (!code) return { promotion: null, reason: "That isn't a valid code." }
  const { data, error } = await db.from('promotions').select(PROMOTION_FIELDS).eq('code', code).maybeSingle()
  if (error || !data) return { promotion: null, reason: `${code} isn't a valid code.` }
  const p = data as Promotion
  const status = promotionStatus(p, today)
  if (!status.ok) return { promotion: null, reason: status.reason }

  let eligible = new Set(productIds)
  if (p.scope_kind === 'collection' && p.scope_collection_id && productIds.length) {
    const { data: rows } = await db
      .from('collection_products')
      .select('product_id')
      .eq('collection_id', p.scope_collection_id)
      .in('product_id', productIds)
    eligible = new Set(((rows ?? []) as { product_id: string }[]).map((r) => r.product_id))
  } else if (p.scope_kind === 'category' && p.scope_category_id && productIds.length) {
    // Primary category or any extra category (product_categories, 0038).
    const [{ data: primary }, { data: extra }] = await Promise.all([
      db.from('products').select('id').eq('category_id', p.scope_category_id).in('id', productIds),
      db.from('product_categories').select('product_id').eq('category_id', p.scope_category_id).in('product_id', productIds),
    ])
    eligible = new Set([
      ...((primary ?? []) as { id: string }[]).map((r) => r.id),
      ...((extra ?? []) as { product_id: string }[]).map((r) => r.product_id),
    ])
  }
  return { promotion: p, eligible }
}

// ── Admin input ─────────────────────────────────────────────────────────────

export type PromotionInput = Omit<Promotion, 'id' | 'times_used'>

const DAY = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Validates an admin create/update body. Money comes in as dollars. */
export function parsePromotionInput(body: Record<string, unknown>): { value: PromotionInput } | { error: string } {
  const code = normalizePromoCode(body.code)
  if (!code) return { error: 'Code: 3–32 letters, numbers, - or _.' }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 80) return { error: 'Name is required (up to 80 characters).' }
  const pct = Number(body.percent_off)
  if (!Number.isFinite(pct) || pct <= 0 || pct > 90 || Math.round(pct * 100) !== pct * 100) {
    return { error: 'Percent off must be between 0.01 and 90.' }
  }
  const day = (v: unknown): string | null | 'bad' =>
    v === null || v === undefined || v === '' ? null : typeof v === 'string' && DAY.test(v) && !Number.isNaN(Date.parse(v)) ? v : 'bad'
  const starts_on = day(body.starts_on)
  const ends_on = day(body.ends_on)
  if (starts_on === 'bad' || ends_on === 'bad') return { error: 'Dates must be YYYY-MM-DD.' }
  if (starts_on && ends_on && starts_on > ends_on) return { error: 'The start date is after the end date.' }

  const scope_kind = body.scope_kind === 'collection' || body.scope_kind === 'category' ? body.scope_kind : 'all'
  let scope_collection_id: string | null = null
  let scope_category_id: string | null = null
  if (scope_kind === 'collection') {
    if (typeof body.scope_collection_id !== 'string' || !UUID.test(body.scope_collection_id)) return { error: 'Choose a collection.' }
    scope_collection_id = body.scope_collection_id
  }
  if (scope_kind === 'category') {
    if (typeof body.scope_category_id !== 'string' || !body.scope_category_id.trim() || body.scope_category_id.length > 100) {
      return { error: 'Choose a category.' }
    }
    scope_category_id = body.scope_category_id.trim()
  }

  let min_subtotal_cents: number | null = null
  if (body.min_subtotal !== undefined && body.min_subtotal !== null && body.min_subtotal !== '') {
    const dollars = Number(body.min_subtotal)
    if (!Number.isFinite(dollars) || dollars < 0 || dollars > 1_000_000) return { error: 'Minimum order must be a dollar amount.' }
    min_subtotal_cents = Math.round(dollars * 100)
  }
  let max_uses: number | null = null
  if (body.max_uses !== undefined && body.max_uses !== null && body.max_uses !== '') {
    const n = Number(body.max_uses)
    if (!Number.isInteger(n) || n < 1 || n > 1_000_000) return { error: 'Usage cap must be a whole number of 1 or more.' }
    max_uses = n
  }
  return {
    value: {
      code,
      name,
      percent_off: pct,
      is_active: body.is_active !== false,
      starts_on,
      ends_on,
      scope_kind,
      scope_collection_id,
      scope_category_id,
      min_subtotal_cents,
      max_uses,
    },
  }
}
