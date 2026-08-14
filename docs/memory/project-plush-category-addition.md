---
name: project-plush-category-addition
description: 2026-08-11 -- added a "Plush" category across both Supabase (livecatalog) and WooCommerce (ly-usa.com), with different scope in each due to Supabase's one-category-per-product constraint vs WooCommerce's multi-category support
type: project
---

Dragon asked to find all plush-like products and group them into a new
"Plush" category, across both catalogs this repo touches.

**Key fact surfaced before doing anything:** Supabase's `cat-047`
(`plush-toys` slug, now named "Toys & Novelties") used to literally **be**
"Plush Toys" — see `docs/CATEGORY-CHANGELOG.md`'s "EXECUTED — 2026-06-25"
entry: Plush Toys (158 products, the largest of five groups)
was deliberately merged with Toys/Squishy-Slime/Sticks Toys/Fidgets/Bubbles
into "Toys & Novelties" as a "high confidence" consolidation. This request
is effectively a partial un-merge. Flagged it to Dragon before writing
anything; confirmed proceeding was still wanted. **How to apply:** any
future "split X back out of a merged category" request — check
`docs/CATEGORY-CHANGELOG.md` for that category's merge history first, don't
just execute the split silently.

**Different scope per system, and why:** identified 184 products (Woo) /
same keyword set (Supabase) matching `/plush|stuffed|teddy|plushie/i` by
name. A meaningful chunk of those (46) are filed under Keychains, Slippers
(Accessories & Apparel in Supabase's coarser taxonomy), Bags/Purses, or
Flowers — e.g. "Plush Keychains", "Teddy Bear Sherpa Slippers", "Plushie
Mountain Bear Backpack".

- **Supabase**: one `category_id` per product — moving those 46 into Plush
  would silently remove them from Keychains/Slippers/Bags-Purses, hurting
  browsability there. Dragon's call: **core toys only** — restricted to
  the 143 already sitting in Toys & Novelties or Flower Bears. See
  `docs/CATEGORY-CHANGELOG.md` ("EXECUTED — 2026-08-11") for the full
  breakdown and revert path; script is `scripts/add-plush-category.mjs`.
- **WooCommerce**: `wc/v3` products support multiple categories — adding
  "Plush Toys" (the category already existed there, 136 products, never
  merged/renamed unlike Supabase) is purely additive, no trade-off. Went
  broad: all 182 matches, including the 46 excluded on the Supabase side.
  Script is `scripts/add-woo-plush-toys-category.mjs`; both dry-run by
  default with `--apply` to write, matching this repo's standard pattern.

**Result:** Supabase has a new `cat-074` "Plush" (143 products, split out
of Toys & Novelties/Flower Bears). WooCommerce's existing "Plush Toys"
category grew from 136 to 182 products (46 added, none removed from their
other category). The two systems are now **intentionally asymmetric** — a
product like "Plushie Mountain Bear Backpack" shows under both Bags/Purses
and Plush Toys on WooCommerce, but only under Bags/Purses on the Supabase
storefront. If this divergence ever causes confusion, the fix is to either
loosen Supabase's schema to multi-category, or revisit the "core toys
only" scope decision — not to silently make one system match the other.
