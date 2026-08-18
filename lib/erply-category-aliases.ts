/**
 * Erply groupName -> Supabase category name, for products coming through
 * the Erply sync (app/api/sync/route.ts) specifically.
 *
 * Erply's own product groups are flatter/more granular than the
 * consolidated categories this catalog actually uses (e.g. Erply splits
 * "Tumblers", "Ceramic Cups", "Speaker Cups" where this catalog has one
 * "Drinkware & Cups"). Derived 2026-08-18 from a live audit of every
 * Erply groupName currently in use and which Supabase category its
 * products predominantly sit in — see docs/memory/project-erply-sync-
 * category-safety.md for the full reasoning and data.
 *
 * Any Erply groupName NOT listed here passes through unchanged (identity
 * mapping) — this covers the 15 categories that already match Erply's
 * name exactly, and lets a genuinely new Erply group still create a
 * sensible new category instead of erroring.
 *
 * This alias map only matters for INSERTING brand-new products. Existing
 * products' category_id is never touched by the sync (see
 * SyncOptions.skipFields including 'category' in app/api/sync/route.ts) --
 * several Supabase categories (Speakers, Humidifier, New Arrivals, Chairs
 * vs Toys, Flower Bears, Gifts, Plate Set) are deliberate manual
 * carve-outs from a broader Erply group with no clean Erply source of
 * their own, and would get silently flattened back into that broader
 * group on every sync run (this cron runs every 30 minutes) if category
 * were reassigned on every update, not just on first insert.
 */
export const ERPLY_CATEGORY_ALIASES: Record<string, string> = {
  // Bucket: single Erply group, differently-named Supabase category
  Crochets: 'Crochet',
  Crown: 'Crowns',
  'Floral Baskets': 'Floral Basket',
  'LED/Electronics': 'LED',
  'Flower Supplies': 'Floral Supplies',
  'Photo Frames': 'Picture Frames',
  'Plush Toys': 'Plush',
  'Seasonal Items': 'Seasonal & Holiday',

  // Bucket: Toys & Novelties spans several Erply subgroups
  Bubbles: 'Toys & Novelties',
  'Squishy / Slime': 'Toys & Novelties',
  Toys: 'Toys & Novelties',
  Fidgets: 'Toys & Novelties',
  'Sticks Toys': 'Toys & Novelties',

  // Bucket: Stationery & Office spans several Erply subgroups
  Pens: 'Stationery & Office',
  Erasers: 'Stationery & Office',
  Sharpeners: 'Stationery & Office',
  'Stationary Supplies': 'Stationery & Office',
  Notebooks: 'Stationery & Office',

  // Bucket: Drinkware & Cups spans several Erply subgroups
  'Speaker Cups': 'Drinkware & Cups',
  Tumblers: 'Drinkware & Cups',
  'Ceramic Cups': 'Drinkware & Cups',
  Drinkware: 'Drinkware & Cups',
  'Plastic Cups': 'Drinkware & Cups',

  // Bucket: Accessories & Apparel spans several Erply subgroups
  Accessories: 'Accessories & Apparel',
  Slippers: 'Accessories & Apparel',
  'Hair Bands': 'Accessories & Apparel',
  Beanies: 'Accessories & Apparel',
  Hats: 'Accessories & Apparel',

  // Bucket: Beauty & Personal Care spans two Erply subgroups
  // (Bags/Purses is its own real category, deliberately NOT aliased here)
  'Beauty Supplies': 'Beauty & Personal Care',
  Mirrors: 'Beauty & Personal Care',
}

export function resolveErplyCategoryAlias(erplyGroupName: string): string {
  return ERPLY_CATEGORY_ALIASES[erplyGroupName] ?? erplyGroupName
}
