# WooCommerce handoff (ly-usa.com)

Updated 2026-11-18 for the team that runs the WooCommerce site. The catalog
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

## 3. Needs an update: 66 prices

Rechecked 2026-11-18: 3,146 of 3,212 site prices equal the catalog (the
2026-11-11 price load; the old 2.40x markup is gone). The other **66 still
have the price from before the 2026-11-12 changes**:

- **58 are higher on the site**, mostly 12-24x. These are pack prices that
  were corrected in the catalog (e.g. $43.25 on the site, $3.50 in the
  catalog; several $12 on the site, $0.50 in the catalog).
- **8 are lower on the site.**

These prices aren't in Erply, so the Erply integration won't fix them. Please
load them the same way as on 11-11. The list is the "price differs" rows of
`woocommerce-vs-catalog-20261118.xlsx` (sent with this handoff).

## 4. For your information (site-side, 2026-11-18 comparison)

- **Same products:** every catalog SKU is on the site; no duplicate or blank
  SKUs. 145 site names still use the old `SKU - name` format.
- **Private:** 148 products became private on the site since 2026-11-13. All
  are hidden in the catalog too, so this matches. Thanks.
- **Publishing:** the site publishes 1,961 products that the catalog hides
  (on 2026-11-13: 1,115 hidden on purpose, 764 with no photo, 77 sold out, 5
  out of stock). 22 products shown in the catalog are drafts on the site.
- **Stock:** 21 products disagree on in-stock (down from 872 on 2026-11-04).
  All 21 are drafts on the site, so customers don't see them.
- **Broken category links (last checked 2026-08-18):** 14 homepage/menu links still 404 because no
  category exists for them: Party Supplies x2, Plate Set x2, Top Sellers x3,
  New Arrivals x3, Sale x4. Either create those categories or point the tiles
  somewhere else (e.g. Sale to an on-sale product query).

## What we need back

1. The 66 prices updated on the site (section 3).
2. OK/corrections on the four guessed category mappings (section 1).
3. Confirmation that Erply's description sync is still off, and whether to
   push descriptions: empty only, replace too, or neither (section 2).
4. A decision on the 14 broken category links, and anything from section 4
   you want a fresh SKU list for.
