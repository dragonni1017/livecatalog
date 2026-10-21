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
 * A renamed slug also matters to the sync: lib/product-sync.ts
 * resolveCategories falls back to an upsert ON CONFLICT (slug) for a name it
 * doesn't know, which would RENAME whichever category held that slug (an
 * unmapped Erply group "Christmas" would have relabelled Seasonal & Holiday).
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
