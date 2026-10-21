/**
 * Category slugs that were renamed, old -> new.
 *
 * These categories kept the slug of whatever category they were merged out
 * of: "Accessories & Apparel" browsed at ?category=slippers, "Seasonal &
 * Holiday" at ?category=christmas. Renamed 2026-10-21 so the URL names the
 * category. Kept here so old links -- bookmarks, shared URLs, search
 * engines, the sitemap they indexed -- land on the right page instead of
 * "category not found".
 *
 * The sync uses the same table: matchExistingCategory sends an incoming
 * name whose slug was renamed ("Christmas") to the renamed category.
 *
 * Never reuse an old slug below for a new category: the redirect only fires
 * when the old slug no longer exists, so reusing it silently ends the
 * redirect for everyone holding an old link.
 */
export const RENAMED_CATEGORY_SLUGS: Readonly<Record<string, string>> = {
  slippers: 'accessories-apparel',
  mirrors: 'beauty-personal-care',
  tumbler: 'drinkware-cups',
  christmas: 'seasonal-holiday',
  pens: 'stationery-office',
  'plush-toys': 'toys-novelties',
}

/**
 * The slug to use for a requested one: itself when a category has it,
 * otherwise its renamed slug when THAT exists, otherwise itself (unknown).
 *
 * Checking both sides makes this safe whichever lands first, the deploy or
 * the SQL that renames the slugs: before the rename the old slug still
 * exists and is kept; after it, the old one is gone and the new one exists.
 */
export function resolveCategorySlug(slug: string, existingSlugs: Iterable<string>): string {
  const known = new Set(existingSlugs)
  if (known.has(slug)) return slug
  const renamed = RENAMED_CATEGORY_SLUGS[slug]
  return renamed && known.has(renamed) ? renamed : slug
}

/**
 * The slug a NEW category gets from its name: "Seasonal & Holiday" ->
 * "seasonal-holiday", "LED/Electronics" -> "led-electronics". Same shape as
 * the slugs renamed above, so a category created by the sync matches the
 * ones curated by hand.
 */
export function categorySlugFor(name: string): string {
  return name.toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export interface ExistingCategory {
  id: string
  name: string
  slug: string
}

/**
 * The existing category an incoming category NAME means, or null when it's
 * genuinely new. Strongest match first:
 *   1. the exact name
 *   2. the name ignoring case and surrounding spaces ("keychains")
 *   3. the slug the name would get -- either form, since slugs made before
 *      2026-10-21 kept "&" as a double dash ("seasonal--holiday")
 *   4. that slug's renamed successor ("Christmas" -> christmas -> the
 *      seasonal-holiday category), so a renamed slug is never re-created
 *      and the redirect for old links keeps working
 *
 * Read-only by design: the sync never creates or updates a category (see
 * resolveCategories in lib/product-sync.ts); a null here means the product
 * lands uncategorized and is reported, not that a category gets made.
 */
export function matchExistingCategory(name: string, categories: ExistingCategory[]): ExistingCategory | null {
  const exact = categories.find((c) => c.name === name)
  if (exact) return exact
  const folded = name.trim().toLowerCase()
  const byName = categories.find((c) => c.name.trim().toLowerCase() === folded)
  if (byName) return byName
  const legacySlug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  for (const slug of new Set([categorySlugFor(name), legacySlug])) {
    const bySlug = categories.find((c) => c.slug === slug)
    if (bySlug) return bySlug
    const renamed = RENAMED_CATEGORY_SLUGS[slug]
    const successor = renamed ? categories.find((c) => c.slug === renamed) : undefined
    if (successor) return successor
  }
  return null
}
