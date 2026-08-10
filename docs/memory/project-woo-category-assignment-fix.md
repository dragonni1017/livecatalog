---
name: project-woo-category-assignment-fix
description: 2026-08-10 -- ly-usa.com WooCommerce had 0 products assigned to any of its 61 categories; backfilled 2,869 via Erply's own groupName field (matches Woo's taxonomy almost exactly). Homepage "Browse by Category" tile links partially fixed; nav menu + duplicate promo blocks still have the same slug-typo bug, deferred
type: project
---

**What was reported:** Dragon said categories weren't all showing on the
ly-usa.com (WooCommerce) homepage.

**Root cause (bigger than a display bug):** every one of WooCommerce's 61
product categories showed a product count of 0 — sampled products directly
in `wp-admin` confirmed every one sat in "Uncategorized". WooCommerce's
category *taxonomy* (all 61 terms) was already correctly built, but no
product had ever actually been assigned to a category.

**Source of truth used:** Erply's own `groupName` field per product
(classic API `getProducts`), NOT this repo's Supabase `categories` table.
Supabase's category set was merged/renamed later (67 -> 43, see
`docs/CATEGORY-CHANGELOG.md`) for the livecatalog storefront's own browsing
UX — coarser than WooCommerce's still-granular 61 categories (e.g. Supabase
merged Accessories/Hair Bands/Beanies/Hats into one "Accessories &
Apparel"; WooCommerce still has all four separately). Confirmed live
2026-08-10: Erply's 57 distinct `groupName` values match WooCommerce's
category names almost exactly (case/whitespace-normalized), so Erply — not
Supabase — is the right source for matching WooCommerce's actual
granularity.

**Fix:** new `scripts/assign-woo-product-categories.mjs` (committed).
SKU-matches Erply active products to WooCommerce products, matches
`groupName` to a WooCommerce category by normalized name, and assigns via
`wc/v3/products/batch` (100/call). Dry run first: 100% clean match — 2,870
Erply products, 2,870 SKU-matched to Woo, 0 unmapped groupNames, 0 no-Woo-match.
Applied live: **2,869 of 2,869 updated, self-verified afterward by
re-fetching from WooCommerce** (1 was already correct from a manual test
write beforehand). Confirmed both in `wp-admin` (category counts now match
Erply's groupName distribution exactly, e.g. Tumblers: 159) and on the live
storefront (category archive pages render products correctly, using
WooCommerce's existing shared archive template — no per-category design
work needed).

**Note on `wc/v3/products` categories field:** unlike the customer `role`
field (see [[project-woo-role-write-fix]]), `categories` on the *products*
resource IS genuinely writable via `wc/v3` — no WP Application Password
workaround needed here. That gotcha was specific to the customer resource.

**Homepage tile-link bug found + partially fixed:** the homepage's "Browse
by Category" grid (Elementor page id 45918, section id `432aaf7`) links to
category slugs that were typo'd/guessed rather than pulled from the real
taxonomy. Fixed 4 of them directly in the Elementor editor (via the
`$e.run('panel/editor/open', ...)` + `elementor.getContainer(id)` JS API,
since normal click-to-select wasn't hitting the right nested widget) and
published:
- Toys & Novelties: `toys-novelties` -> `toys` (widget `d6c7b63`)
- Backpacks & Purses: `backpacks-purses` -> `bags-purses` (widget `4eaf0d1`)
- Stationery Supplies: `stationery-supplies` -> `stationary-supplies` (widget `402816b`)
- Seasonal: `seasonal` -> `seasonal-items` (widget `78a1275`)

Accessories and Drinkware tiles in that same section were already correct.
Party Supplies and Plate State tiles were deliberately left alone —
**neither has a real backing category anywhere** (not in WooCommerce, not
in Erply's groupNames, not even in Supabase's 43-category set) — Dragon
chose not to decide on these yet.

**NOT fixed, deferred by Dragon 2026-08-10 — same bug, much bigger
footprint:** a full sweep of the homepage found **27 of 76 total
`product-category` links broken**, including:
- The **top-level nav dropdown headers themselves** — "Toys" links to
  `toys-novelties` (404), "Drinkware" links to `drinkware-cups` (404) —
  not just decorative tiles, the actual main-nav menu items
- More mega-menu sub-item typos: "Florals/Gifts" -> `gifts` (should be
  `florals-gifts`, and `gifts` is itself a nearly-empty different
  category), "Floral Basket" -> `floral-basket` (should be plural
  `floral-baskets`), "Crochet" -> `crochet` (should be `crochets`)
- A **duplicated promo block** inside a mega-menu dropdown (widget
  `57d44ab` and `baed349`) repeating several of the same broken tiles
  again, plus a third distinct typo not seen elsewhere: "Backpacks &
  Purses" -> `backups-purses` (widget `5616315`)
- Top Sellers / New Arrivals / Sale tiles also 404 as category pages —
  these were likely never meant to be real `product_cat` terms (smart/
  curated collections), not investigated further

**Why:** the homepage/nav content was evidently built with guessed or
copy-pasted category slugs rather than checked against the real taxonomy —
same root cause as the missing product assignments, just a second,
separate place it surfaced. Fixing the full 27-link sweep is real,
scoped work (~30-45 min of the same editor-API approach used for the 4
tiles) — Dragon chose to stop after the original 4-tile ask rather than
open-end the session.

**How to apply:** if this comes up again, don't re-investigate from
scratch — the valid WooCommerce slug list (61 categories) is in this file's
git history via the script; re-derive it live via `wc/v3/products/categories`
rather than trusting it's unchanged. The `$e.run('panel/editor/open', {
model: container.model, view: container.view })` + `elementor.getContainer(id)`
pattern (run in the browser console / via javascript_tool against the
**top-level** Elementor editor window, not the iframe) is the reliable way
to open a specific widget's settings panel for automation — plain
click-based selection was unreliable on this page (widgets are nested
several levels deep inside sections/columns and clicks didn't register
against the actual widget most of the time).
