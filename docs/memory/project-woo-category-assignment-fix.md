---
name: project-woo-category-assignment-fix
description: 2026-08-10 -- ly-usa.com WooCommerce had 0 products assigned to any of its 61 categories; backfilled 2,869 via Erply's own groupName field (matches Woo's taxonomy almost exactly). Homepage tile links + the full 27-link sweep (nav menu, mega-menu, duplicate promo blocks) fixed 2026-08-11; 14 links remain 404 by design (no backing category exists)
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

**27-link sweep fixed 2026-08-11.** Re-derived the live 61-slug list via
`wc/v3/products/categories` (unchanged from 08-10 except the `gifts` slug
no longer exists at all — confirms it was never a real category, just a
typo target). A full DOM scan of `a[href*="product-category"]` on the
homepage (`document.querySelectorAll`, checked `href` slug against the
valid set) found exactly 27 broken links across 4 separate places, each
needing a different edit mechanism:

- **Top nav headers** (Florals/Gifts, Toys, Drinkware) are NOT part of any
  Elementor template — they're a real WordPress nav menu (`menu=21`, "main
  menu (Header)", the one assigned to the Header location; do not confuse
  with the unrelated "About us" menu, id 24). Fixed via
  `wp-admin/nav-menus.php?action=edit&menu=21`, editing the
  `input[name="menu-item-url[ID]"]` fields directly and clicking Save.
  **Gotcha: the `find` tool's cached element coordinates went stale after
  the page's dismissible admin notices re-rendered — a `find`-based click
  on "Save Menu" landed on the sidebar "Payments" menu instead, and the
  save silently never happened** (page looked identical, no error, but a
  fresh reload showed the old values still there). Confirm any wp-admin
  form save by reloading the page fresh afterward and re-reading the
  values — don't trust that a click "succeeded" just because no error
  appeared. Clicking the button by DOM id via
  `document.getElementById('save_menu_header').click()` in
  javascript_tool worked reliably; prefer that over coordinate-based
  clicks for admin-UI buttons that move around dismissible notices.
- **Mega-menu dropdown content** for the Florals/Gifts nav item lives in
  Elementor template id **46258** (title
  `dynamic-content-megamenu-menuitem45947` — ElementsKit names these
  per-menu-item templates `...menuitem{ID}`, one per top-level nav item
  with a mega menu). Fixed `icon-list` widgets `e7e5fa6` (Floral Basket
  -> `floral-baskets`, Crochet -> `crochets`) and `8dc27a7` (Gifts ->
  `florals-gifts`).
- **Duplicated promo block** (appears twice in the mega-menu) is Elementor
  template id **48511** (title "LY Footersss" — a shared footer/promo
  template reused inside the mega-menu, hence "duplicate"). Fixed
  `icon-list` widgets `57d44ab` (Toys & Novelties -> `toys`, Backpacks &
  Purses -> `bags-purses`) and `baed349` (Stationery Supplies ->
  `stationary-supplies`, Gifts -> `florals-gifts`, Seasonal ->
  `seasonal-items`).
- **Homepage** itself (template **45918**) had one more instance not
  caught in the original 4-tile fix: `icon-box` widget `5616315`
  (Backpacks & Purses -> `backups-purses`, fixed to `bags-purses`).

For `icon-list` repeater widgets, read/write the whole array via
`container.model.get('settings').toJSON().icon_list` (must call
`.toJSON()` — the raw `.get('icon_list')` returns a Backbone Collection,
not plain objects, and `.link.url` access on it throws). Write back with
`$e.run('document/elements/settings', { container, settings: { icon_list:
updatedArray } })`, matching only the target `_id`(s) and spreading the
rest unchanged. For a single-link widget (`icon-box`), same command with
`settings: { link: {...existingLink, url: newUrl} }`. Save with `await
$e.run('document/save/update')`; confirm by checking the top-bar Publish/
Update button is greyed out (disabled = no pending changes = saved).

**Front-end cache:** this site has a caching plugin exposing a "Clear Site
Cache" link in `#wpadminbar`. Elementor template edits and the WP menu
edit did not appear on the live front-end until this was clicked — always
clear it and re-fetch the live page after any content edit here before
concluding a fix didn't take effect (the WP menu save failure above was
real, not a caching illusion, but caching was *also* in play and would
have masked the same symptom either way).

**Verified 2026-08-11:** live DOM scan post-fix shows exactly 14 broken
`product-category` links remain, all in the "no real backing category"
bucket identified 08-10 (Party Supplies x2, Plate State x2, Top Sellers
x3, New Arrivals x3, Sale x4) — 13 of the original 27 were genuine
slug-typo fixes now applied; the other 14 need a business decision (either
create matching WooCommerce categories, or repoint these tiles to
something else — e.g. a "Sale" tile might belong on a WooCommerce sale
query/shortcode rather than a `product_cat` term) before they can be
fixed, not another editor pass.
