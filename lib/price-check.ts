/**
 * "Was this typed as the whole case?" -- a catalog price that is really the
 * price of a case of boxes.
 *
 * Prices are entered by hand in Erply and the sync owns price_cents
 * (decided 2026-10-02), so the catalog can't stop a wrong one going in. It
 * can say so before customers see it: /admin/cleanup's "Case price?" tab
 * and the Needs pricing tab's unhide both use this. On 2026-10-21 it flagged
 * 9 live products, e.g. F286938 at $180 = 60 boxes x $3 in a category whose
 * median is $3.
 *
 * The rule is deliberately narrow (scripts/build-price-outlier-list.mjs uses
 * the same one): a price at least 20x its category's median, a name that
 * states at least 24 boxes per case, and dividing by those boxes lands
 * within 2x of the median. Dividing by a small box count lands near the
 * median by chance (a $33 hair dryer / 20 bx is not a $1.65 one). Pure.
 */

export const CASE_PRICE_RATIO = 20
export const CASE_MIN_BOXES = 24
/** Categories with fewer priced products have no meaningful median. */
export const CATEGORY_MIN_SIZE = 8

/** "20/pk 60bx/cs" -> 60. */
export function boxesPerCase(name: string): number | null {
  return Number(/(\d+)\s*bx\s*\/\s*cs/i.exec(name)?.[1]) || null
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export interface PricedRow {
  sku: string | null
  category_id: string | null
  price_cents: number | null
  is_active: boolean
  manually_hidden: boolean | null
}

/**
 * Median price per category over what customers see: active, not hidden,
 * priced. Hidden products are left out so a batch of unpriced-then-mispriced
 * receiving products can't drag their own category's median up.
 */
export function categoryMedians(rows: PricedRow[]): Map<string, number> {
  const byCat = new Map<string, number[]>()
  for (const r of rows) {
    if (!r.sku || !r.category_id || !r.is_active || r.manually_hidden || !((r.price_cents ?? 0) > 0)) continue
    const list = byCat.get(r.category_id) ?? []
    list.push(r.price_cents!)
    byCat.set(r.category_id, list)
  }
  const out = new Map<string, number>()
  for (const [id, prices] of byCat) if (prices.length >= CATEGORY_MIN_SIZE) out.set(id, median(prices))
  return out
}

export interface CasePriceFlag {
  boxes: number
  perBoxCents: number
  medianCents: number
}

export function likelyCasePrice(
  p: { name: string; price_cents: number | null },
  medianCents: number | undefined,
): CasePriceFlag | null {
  const price = p.price_cents ?? 0
  if (!medianCents || price <= 0 || price / medianCents < CASE_PRICE_RATIO) return null
  const boxes = boxesPerCase(p.name)
  if (!boxes || boxes < CASE_MIN_BOXES) return null
  const perBox = price / boxes
  const r = perBox / medianCents
  return r >= 0.5 && r <= 2 ? { boxes, perBoxCents: perBox, medianCents } : null
}

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`

/** "$180.00 = 60 bx × $3.00; the category median is $3.00" */
export function describeCasePrice(priceCents: number, f: CasePriceFlag): string {
  return `${usd(priceCents)} = ${f.boxes} bx × ${usd(f.perBoxCents)}; the category median is ${usd(f.medianCents)}`
}
