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

## 3. For your information (site-side, from the 2026-11-13 comparison)

- **Same products:** every catalog SKU is on the site. 145 site names still
  use the old `SKU - name` format.
- **Prices:** fixed. Since the 2026-11-11 price load, 3,146 of 3,212 site
  prices equal the catalog. The 66 differences are the 65 prices changed
  2026-11-12 plus one discontinued draft. The old 2.40x markup is gone.
- **Publishing:** the site publishes 1,961 products that the catalog hides:
  1,115 hidden on purpose, 764 with no photo, 77 sold out, 5 out of stock.
- **Stock:** 21 products disagree on in-stock (down from 872 on 2026-11-04).
  The per-SKU list is in the 2026-11-13 handoff sheet.
- **Broken category links (last checked 2026-08-18):** 14 homepage/menu links still 404 because no
  category exists for them: Party Supplies x2, Plate Set x2, Top Sellers x3,
  New Arrivals x3, Sale x4. Either create those categories or point the tiles
  somewhere else (e.g. Sale to an on-sale product query).

## What we need back

1. OK/corrections on the four guessed category mappings (section 1).
2. Confirmation that Erply's description sync is still off, and whether to
   push descriptions: empty only, replace too, or neither (section 2).
3. A decision on the 14 broken category links, and anything from section 3
   you want a fresh SKU list for.
