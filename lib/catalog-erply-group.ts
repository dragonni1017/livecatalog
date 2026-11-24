/**
 * Catalog category -> the Erply product group a new product is created in.
 *
 * The reverse of lib/erply-category-aliases.ts. Receiving picks the CATALOG
 * category (the catalog owns categories: the sync never overwrites one, see
 * skipFields in app/api/sync/route.ts), and Erply still needs some group on
 * create. Most categories have exactly one Erply group whose leaf name
 * aliases onto them; the overrides below settle the rest, each from where
 * that category's existing products sit in Erply (sampled 2026-11-24).
 *
 * A category with no group here (LED/Electronics, Signs/Animals — both empty)
 * can't be picked on Receiving until one is added.
 */
import { resolveErplyCategoryAlias } from './erply-category-aliases'

export interface ErplyGroupRef {
  id: number
  /** Path-style label from getErplyProductGroups: "Florals/Gifts / Papers". */
  name: string
}

export const CATALOG_TO_ERPLY_GROUP: Record<string, string> = {
  // Several Erply groups alias onto these; the one most of their products use.
  'Accessories & Apparel': 'General Merchandise / Accessories',
  'Beauty & Personal Care': 'General Merchandise / Beauty Supplies',
  'Drinkware & Cups': 'Drinkware / Tumblers',
  'Floral Supplies': 'Florals/Gifts / Floral Supplies',
  LED: 'LED/Electronics',
  'Picture Frames': 'General Merchandise / Picture Frames',
  'Stationery & Office': 'General Merchandise / Stationary Supplies',
  'Toys & Novelties': 'Toys',
  // Catalog carve-outs with no Erply group of their own.
  Gifts: 'Gift Boxes',
  Humidifier: 'LED/Electronics / Lamps',
  Speakers: 'LED/Electronics',
}

const leaf = (groupName: string) => groupName.split(' / ').pop()!.trim()

export function erplyGroupForCategory(category: string, groups: ErplyGroupRef[]): ErplyGroupRef | null {
  const wanted = category.trim().toLowerCase()
  const override = Object.entries(CATALOG_TO_ERPLY_GROUP).find(([c]) => c.toLowerCase() === wanted)?.[1]
  if (override) return groups.find((g) => g.name.toLowerCase() === override.toLowerCase()) ?? null
  // Otherwise the group whose leaf aliases onto this category; the shallowest
  // if several ("Drinkware" over "Drinkware / Tumblers"), then Erply's order.
  const hits = groups.filter((g) => resolveErplyCategoryAlias(leaf(g.name)).toLowerCase() === wanted)
  return hits.sort((a, b) => a.name.split(' / ').length - b.name.split(' / ').length)[0] ?? null
}

/**
 * A staged line's proposed_category as a catalog category name. Lines staged
 * before 2026-11-24 hold an Erply group label ("Florals/Gifts / Papers"),
 * which maps through the alias table; null when it matches no category.
 */
export function catalogCategoryFor(proposed: string | null | undefined, categoryNames: string[]): string | null {
  if (!proposed) return null
  const byLower = new Map(categoryNames.map((n) => [n.toLowerCase(), n]))
  return byLower.get(proposed.toLowerCase()) ?? byLower.get(resolveErplyCategoryAlias(leaf(proposed)).toLowerCase()) ?? null
}
