import { isSeasonSoon, seasonOf, type SeasonInfo } from './seasons.ts'

// Photo shot list: active products still needing a photo, in the order worth
// shooting them. Nearly all of them are hidden (799 of 801 on 2026-11-04), so
// storefront views can't rank them; the signals are the ones below.
//
// Order:
//   1. seasonal, holiday coming up (soonest first) -- worthless once it passes
//   2. customers searched the SKU and got nothing (most searched first)
//   3. everything else; a season that just ended goes last
// then within each: priced before $0 (a $0 product stays hidden after its
// photo), most recently arrived, most stock, SKU.

export interface ShotListInput {
  id: string
  sku: string | null
  name: string | null
  image_url: string | null
  needs_photo: boolean | null
  is_active: boolean | null
  manually_hidden: boolean | null
  stock_qty: number | null
  price_cents: number | null
  arrived_at: string | null
  category_id: string | null
}

export interface ShotListRow<P extends ShotListInput = ShotListInput> {
  product: P
  season: SeasonInfo | null
  searches: number
  /** Has an image but is flagged for a new one. */
  reshoot: boolean
}

/** Same rule as lib/cleanup.ts classifyProduct's photo flag. */
export function needsPhoto(p: Pick<ShotListInput, 'image_url' | 'needs_photo'>): boolean {
  return !(p.image_url ?? '').trim() || p.needs_photo === true
}

function tier(r: ShotListRow): number {
  if (isSeasonSoon(r.season)) return 0
  if (r.searches > 0) return 1
  return r.season?.over ? 3 : 2
}

export function rankShotList<P extends ShotListInput>(
  products: P[],
  searchesById: Map<string, number>,
  now: Date = new Date(),
): ShotListRow<P>[] {
  const rows: ShotListRow<P>[] = products
    .filter((p) => p.is_active && p.sku?.trim() && needsPhoto(p) && (p.stock_qty ?? 0) > 0)
    .map((p) => ({
      product: p,
      season: seasonOf(p.name ?? '', now),
      searches: searchesById.get(p.id) ?? 0,
      reshoot: Boolean((p.image_url ?? '').trim()),
    }))
  return rows.sort((a, b) => {
    const ta = tier(a)
    const tb = tier(b)
    if (ta !== tb) return ta - tb
    if (ta === 0 && a.season!.daysLeft !== b.season!.daysLeft) return a.season!.daysLeft - b.season!.daysLeft
    if (ta === 1 && a.searches !== b.searches) return b.searches - a.searches
    const pa = (a.product.price_cents ?? 0) > 0 ? 0 : 1
    const pb = (b.product.price_cents ?? 0) > 0 ? 0 : 1
    return (
      pa - pb ||
      (b.product.arrived_at ?? '').localeCompare(a.product.arrived_at ?? '') ||
      (b.product.stock_qty ?? 0) - (a.product.stock_qty ?? 0) ||
      (a.product.sku ?? '').localeCompare(b.product.sku ?? '')
    )
  })
}

/** Short "why it's here" labels for the list. */
export function shotReasons(r: ShotListRow): string[] {
  const out: string[] = []
  if (isSeasonSoon(r.season)) out.push(`${r.season!.label} in ${r.season!.daysLeft} day${r.season!.daysLeft === 1 ? '' : 's'}`)
  if (r.searches > 0) out.push(`searched ${r.searches}×`)
  if (r.reshoot) out.push('new photo wanted')
  if (!((r.product.price_cents ?? 0) > 0)) out.push('$0: stays hidden until priced')
  return out
}
