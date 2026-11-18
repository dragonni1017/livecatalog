# WooCommerce handoff (ly-usa.com)

Written 2026-11-18 for the team that runs the WooCommerce site. The catalog
(this repo) only reports on WooCommerce or offers files for it; every change
to the live site is that team's call. Numbers are from the dates given;
re-run the scripts named below for fresh ones.

## 1. Ready now: product import file

**Where:** catalog admin -> `/admin/woo-export` -> download CSV.

**What's in it:** every catalog product that is active, shown, and has a
photo, a price, a category and a real description (1,163 on 2026-11-06).
Columns use WooCommerce's own import names.

**How to import:** Products -> Import -> tick **"Update existing products"**.
Rows match existing products by SKU; nothing new should be created.

**Left out on purpose:** name, price and stock. Erply's WooCommerce
Integration already syncs those, so the file never fights it.

**Optional columns (off by default):**
- **Categories:** sent as full paths (`Florals/Gifts > Papers`), because a
  bare name makes the importer create a new top-level category. Four mappings
  are best guesses with no clear match on the site. Please confirm or correct:

  | Catalog category | Sent as |
  |---|---|
  | Humidifier | LED/Electronics |
  | Speakers | LED/Electronics |
  | Plate Set | General Merchandise |
  | Signs/Animals | General Merchandise > Deco |

  A product whose category has no mapping is left out of the file.
- **Images:** leave off unless you want them. Re-importing images adds
  duplicate copies to the media library.

## 2. Waiting on you: product descriptions

`scripts/push-catalog-descriptions-to-woo.ts` copies the catalog's written
descriptions into WooCommerce's long description. It has only been run as a
dry run. Two questions first:

1. **Does Erply's WooCommerce Integration sync descriptions?** On 2026-08-17,
   Erply back office -> Apps -> Woocommerce Integration -> Field mapping ->
   "Sync Erply fields" had **Short description and Long description OFF**.
   Please confirm they are still off. If they are on, Erply's next sync would
   overwrite what we push.
2. **May we write them?** Two batches:
   - **Empty only (default):** 180 products with no description on the site.
     Nothing is replaced.
   - **Replace:** 963 products whose site text differs, mostly just the name,
     pack spec or a warehouse note. This replaces existing text.

Every write saves the old text to a backup CSV and the audit log first, and
`--undo=<backup.csv>` puts it back.

## 3. For your information (site-side, from the 2026-11-04 comparison)

- **Same products:** 3,361 SKUs match. Nothing in the catalog is missing from
  WooCommerce. 7 WooCommerce drafts aren't in the catalog. 145 site names still
  use the old `SKU - name` format.
- **Prices:** 2,799 of 3,190 site prices are exactly 2.40x the Erply price,
  which matches the old "Retail = base + 140%" markup. Erply's own data is
  correct, so the extra markup is applied on the site side (most likely the
  Wholesale For WooCommerce plugin or the integration's price-list setting).
  The other 391 are explained: 183 price changes not yet in Erply, 142
  discontinued, 66 rounding.
- **Publishing:** the site publishes 3,193 products and the catalog shows
  1,183. The difference is products hidden here on purpose, with no photo, or
  priced $0. 22 products shown in the catalog are drafts on the site.
- **Stock:** 851 products are in stock in Erply but marked out of stock on the
  site. They are all products without photos that were set out of stock in
  August.
- **Broken category links:** 14 homepage/menu links still 404 because no
  category exists for them: Party Supplies x2, Plate Set x2, Top Sellers x3,
  New Arrivals x3, Sale x4. Either create those categories or point the tiles
  somewhere else (e.g. Sale to an on-sale product query).

## What we need back

1. OK/corrections on the four guessed category mappings (section 1).
2. Confirmation that Erply's description sync is still off, and whether to
   push descriptions: empty only, replace too, or neither (section 2).
3. Anything from section 3 you want a fresh list for. We can produce SKU
   lists for any of those groups.
