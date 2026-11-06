// Catalog category -> WooCommerce category path, for the WooCommerce export's
// optional Categories column (lib/woo-export.ts).
//
// WooCommerce categories are nested ("Florals/Gifts > Papers") and its CSV
// importer reads each "A > B" from the top: a plain "Papers" means a
// TOP-LEVEL "Papers", which doesn't exist, so it would be created as a
// duplicate. So the export sends the full path, never the bare name.
//
// Checked against ly-usa.com's 61 WooCommerce categories on 2026-11-06.
// The site has no WooCommerce keys in production, so this can't be looked up
// live; re-check with data/woo-cat-compare.mts if WooCommerce's tree changes.
// `guess` marks a mapping with no clear match on the WooCommerce side.

export interface WooCategoryPath {
  path: string
  guess?: true
}

export const WOO_CATEGORY_PATHS: Record<string, WooCategoryPath> = {
  '3D Printed': { path: 'Toys > 3D Printed' },
  'Accessories & Apparel': { path: 'General Merchandise > Accessories' },
  'Bags/Purses': { path: 'General Merchandise > Bags/Purses' },
  'Beauty & Personal Care': { path: 'General Merchandise > Beauty Supplies' },
  Blankets: { path: 'General Merchandise > Blankets' },
  Bows: { path: 'Florals/Gifts > Bows' },
  Candles: { path: 'Florals/Gifts > Candles' },
  Candy: { path: 'General Merchandise > Candy' },
  Chairs: { path: 'General Merchandise > Chairs' },
  Crochet: { path: 'General Merchandise > Crochets' },
  Crowns: { path: 'Florals/Gifts > Crown' },
  Deco: { path: 'General Merchandise > Deco' },
  Dome: { path: 'LED/Electronics > Dome' },
  'Drinkware & Cups': { path: 'Drinkware' },
  Fan: { path: 'General Merchandise > Fan' },
  'Floral Basket': { path: 'Florals/Gifts > Floral Baskets' },
  'Floral Boxes': { path: 'Florals/Gifts > Floral Boxes' },
  'Floral Supplies': { path: 'Florals/Gifts > Floral Supplies' },
  'Flower Bears': { path: 'Florals/Gifts > Flower Bears' },
  'Flower Spray': { path: 'Florals/Gifts > Flower Spray' },
  Flowers: { path: 'Florals/Gifts > Flowers' },
  'Forever Roses': { path: 'Florals/Gifts > Forever Roses' },
  'Gift Bags': { path: 'Florals/Gifts > Gift Bags' },
  Gifts: { path: 'Florals/Gifts' },
  Humidifier: { path: 'LED/Electronics', guess: true },
  Keychains: { path: 'General Merchandise > Keychains' },
  Lamps: { path: 'LED/Electronics > Lamps' },
  LED: { path: 'LED/Electronics > LED' },
  'LED/Electronics': { path: 'LED/Electronics' },
  Leis: { path: 'Florals/Gifts > Leis' },
  'Mesh Paper': { path: 'Florals/Gifts > Mesh Paper' },
  Papers: { path: 'Florals/Gifts > Papers' },
  'Picture Frames': { path: 'General Merchandise > Picture Frames' },
  'Plate Set': { path: 'General Merchandise', guess: true },
  Plush: { path: 'Toys > Plush Toys' },
  Ribbons: { path: 'Florals/Gifts > Ribbons' },
  'Seasonal & Holiday': { path: 'Seasonal Items' },
  'Signs/Animals': { path: 'General Merchandise > Deco', guess: true },
  Skateboard: { path: 'General Merchandise > Skateboard' },
  Speakers: { path: 'LED/Electronics', guess: true },
  'Stationery & Office': { path: 'General Merchandise > Stationary Supplies' },
  'Toys & Novelties': { path: 'Toys' },
  Umbrella: { path: 'General Merchandise > Umbrella' },
}

/** The WooCommerce path for a catalog category name, or null when it isn't mapped. */
export function wooCategoryPath(catalogName: string | null): string | null {
  return catalogName ? (WOO_CATEGORY_PATHS[catalogName]?.path ?? null) : null
}
