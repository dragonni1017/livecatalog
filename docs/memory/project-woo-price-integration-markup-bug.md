---
name: project-woo-price-integration-markup-bug
description: CORRECTED 2026-08-13 -- WooCommerce (ly-usa.com) shows every product at exactly 2.400x, but the stored _regular_price postmeta is actually correct (matches Erply); the 2.4x is applied by an unfound display/API-time filter on the WooCommerce/WordPress side, NOT an Erply markup setting and NOT the Wholesale For WooCommerce plugin's role pricing (both ruled out)
type: project
---

**Confirmed live 2026-08-12 (read-only checks, no writes):** every priced
product sampled on ly-usa.com shows `regular_price` = Erply's raw `price`
field × exactly **2.400**, with zero variance. Checked 16 SKUs total across
two batches — 8 of the most recently created Woo products (dated
2026-08-11, after the retail-anchor rebase) and 8 of the oldest (dated
2022-10-27, long before it) — both batches landed on ratio 2.400 with no
exceptions. This rules out "new products entered with stale base-price
convention" as the cause; it's a uniform, catalog-wide multiplier applied
somewhere in the Erply->WooCommerce price sync itself.

**Root cause (high confidence, not yet visually confirmed in the Erply UI):**
2.400 = 1 + 1.40, exactly matching the *old* pre-flip Retail markup formula
("Retail = base + 140%") from before [[project-retail-anchor-pricing-flip]]
(2026-08-04). That flip rebased Erply's raw `price` field so it already
**equals** the Retail-anchor amount catalog-wide (confirmed at the time via
full re-fetch of all 2,871 products) — no further markup should be needed.
The WooCommerce side almost certainly still has a leftover +140%
markup/price-list setting in Erply's native **WooCommerce Integration**
app (Payment & Pricing step — see [[project-woocommerce-tier-mapping]] for
where this app was first discovered, and its "only ONE price list for
regular prices, store-wide" limitation) that was never touched during the
Aug 4 flip, since that flip only edited Erply's internal Price List
records ([[project-erply-customer-tiers]] group/list IDs) and Erply CRM
groups — nobody thought to also check the WooCommerce Integration app's
own settings screen.

**This is NOT fixable from this repo's code.** `lib/erply.ts` /
`lib/woo.ts` don't control this sync at all — it's Erply's own SaaS
integration app, configured entirely in Erply's back office UI (no API
access to read/write its settings found so far). The fix is manual:

**How to apply:** in Erply back office → Apps → WooCommerce Integration →
Payment & Pricing step, find the "Price List for Regular Prices" (or
similarly-named markup) field and set it so it applies **0% adjustment** —
either by pointing it at the "Retail" price list (priceListId 8,
`discountPercent: 0`, confirmed current) or by zeroing a standalone
markup-% field if that's what it turns out to be. Target: raw pass-through
of Erply's `price` field, ratio should read 1.000 afterward, not 2.400.
Dragon is doing this manually (2026-08-12) — not yet confirmed fixed as of
this writing. **Before trusting any WooCommerce price shown in this repo's
UI or scripts, re-run the cross-check (Woo `regular_price` vs Erply raw
`price` by SKU) rather than assuming this has been fixed** — the same
caution pattern as every other Erply/Woo item in this project.

**Re-checked 2026-08-13: still broken.** Same 16-SKU sample (8 newest + 8
oldest published Woo products, matched to Erply via exact `code` lookup —
note `getProducts` needs the `code` param for an exact match, `searchCode`
returned nothing) — ratio is still uniformly 2.400 across all 16, no
variance. The Erply-side WooCommerce Integration app markup fix has not
been applied yet (or hasn't taken effect).

**Why this matters beyond just cosmetics:** the WooCommerce site is the
one wired to actually take customer orders at whatever price it displays —
until this is fixed, every walk-up/logged-out or unassigned-role visitor
to ly-usa.com is being shown a price 2.4x higher than the intended Retail
anchor, not just an internal reporting mismatch.

**MAJOR CORRECTION 2026-08-13, same day — the root cause above is WRONG.**
Dragon said he was editing prices directly in WooCommerce (Wholesale For
WooCommerce plugin's "price tiers" screens) and that they looked correct
on his end, which didn't match the still-broken 2.400x read from the API.
Investigated live via browser (wp-admin, product F286801 / post 54320,
"10\" Gold Gift Bow"):

- **The actual stored WooCommerce data is correct.** The product edit
  screen's own "Regular price ($)" field (`Products -> Edit product ->
  Product data -> General`) reads **$12** — the same raw value the wc/v3
  REST API and the live front-end product page (`/?p=54320`) show as
  **$28.80** (still exactly 2.400x). The WP admin edit form binds directly
  to the `_regular_price` postmeta with no filters in the way, so this
  proves the underlying data was never actually 2.4x'd — the multiplier is
  applied at **display/API time**, not stored in the database.
- **Ruled out: Wholesale For WooCommerce plugin's own pricing rules.**
  Checked both the per-product override screen (`Wholesale -> Bulk
  Wholesale Pricing`, "+"-expand on a product -> Chain/Distributor/
  Exclusive/Retail/Wholesale rows, all "Enable for Role" unchecked, all
  values blank for the sampled products) and the global default screen
  (`Wholesale -> Settings -> Wholesale Price Global`, same 5 roles, Retail
  role's "Enable Role" is unchecked and "Wholesale Value" is blank). Only
  a checked-and-valued row here could apply a role-based adjustment, and
  none were found configured on the products checked.
- **Ruled out: multi-currency.** WooCommerce's own "Multi-currency"
  settings tab (`wc-settings&tab=multi_currency`) renders empty (no
  currencies configured), and the active-plugins list
  (`wp-admin/plugins.php`, 58 total) has no dedicated currency-switcher
  plugin at all.
- **Not yet found:** something is still hooking WooCommerce's price
  output (`get_regular_price()`/`get_price()`/REST API serialization) to
  multiply by 2.400 specifically outside the wp-admin edit-form context.
  Likely a custom filter in the active theme's `functions.php`, a code
  snippet in "Simple Custom CSS and JS" (installed and active on this
  site, exact settings page not yet located —
  `admin.php?page=sccss-settings` 403'd), or possibly leftover logic in
  one of the ERP/multichannel sync plugins also installed (NetSuite
  Integration for WooCommerce, TM NetSuite, Codisto Channel Cloud) — not
  narrowed down further this session.

**How to apply:** stop looking at Erply's WooCommerce Integration app for
this — [[project-retail-anchor-pricing-flip]]'s $12 raw price and this
product's stored WooCommerce regular_price agree exactly, so the Erply
sync itself is fine. The bug is 100% on the WooCommerce/WordPress side, in
whatever is filtering the price between storage and display/API. Next
step for whoever picks this up: grep the theme and any custom-snippet
plugin for a `woocommerce_get_price`/`woocommerce_product_get_regular_price`/
`woocommerce_product_get_price` filter, or a hardcoded `* 2.4` /
`1.4` multiplier, rather than touching anything in Erply or the Wholesale
For WooCommerce plugin's role/tier settings (both confirmed clean). If
Dragon's in-progress "price tiering" edits in the Wholesale plugin aren't
fixing the live price, that's expected now — they were never the source.

**Further investigation, same session (2026-08-13), no writes/changes made
— Dragon said to stop investigating further and just record findings.**
Went through the code (WordPress `wp-admin` Theme Editor / Plugin Editor,
read-only) looking for the actual filter:

- **Found a real candidate, but it doesn't fully check out by source
  reading.** The active theme (Hello Elementor Child) `functions.php`
  contains custom code (not part of any Elementor/Hello Theme default)
  that re-registers a function called `wsds_return_price()` — clearly from
  the **"Woocommerce Sale Discount Scheduler"** plugin (by Geek Code Lab,
  version 1.5, folder `woo-sale-discount-scheduler` — a small, obscure,
  homebrew-looking plugin, not a mainstream one) — onto WooCommerce's
  `woocommerce_product_get_price` filter (the hook that controls
  `get_price()`, i.e. what's actually displayed/served):
  ```php
  if ( function_exists( 'wsds_return_price' ) ) {
      remove_filter( 'woocommerce_product_get_price', 'wsds_return_price', 10 );
      add_filter( 'woocommerce_product_get_price', function( $price, $product ) {
          global $post;
          if ( ! is_object( $post ) ) { return $price; }
          return wsds_return_price( $price, $product );
      }, 10, 2 );
  }
  ```
  This is clearly a manual patch someone added to null-guard the plugin's
  own hook (likely to fix a fatal/warning when `$post` isn't set, e.g. in
  REST/cron context) — meaning someone has touched this exact code path
  before and knows it's fragile.
- **But the plugin's own `wsds_return_price()` (in
  `woo-sale-discount-scheduler/functions.php`) only ever discounts, and
  only for products actively on its schedule.** Read the full function:
  it calls `wsds_get_schedule_product_list(1)` (products where postmeta
  `wsds_schedule_sale_status = 1` AND `wsds_schedule_sale_mode = 1`) and,
  for products in that list, computes `regular_price - (regular_price *
  sale_%/100)` or a flat subtraction — a genuine discount-down calculation,
  never a markup. **For any product NOT on the list it returns `$price`
  unchanged.** The sample product used throughout this investigation
  (F286801, post 54320) has its own "Schedule Sale Discount" tab set to
  `Status: Disable`, so per this code it should NOT be affected — yet its
  live price is still 2.400x. Either this analysis is missing something
  (filter priority/ordering, a second hook registration, a bug in how the
  schedule list is checked) or the plugin isn't actually the cause for
  this product and something else — not yet found — is multiplying the
  price before this filter even runs.
- **Not yet ruled out: the "Wholesale For WooCommerce" plugin's own PHP
  code** (folder `woocommerce-wholesale-pricing`, v2.7.0, WPExperts — a
  large premium plugin with a `build/` and `inc/` folder). Its *settings
  screens* were already confirmed clean (see above), but plugin code can
  have default/fallback behavior that isn't exposed in the UI at all — did
  not get through reading its `inc/` source this session, it's too large
  to fully grep manually via the WP Plugin Editor one file at a time.
- **Fastest remaining diagnostic, NOT performed this session (deliberately
  — Dragon said don't touch anything, just record):** temporarily
  deactivate "Woocommerce Sale Discount Scheduler" and immediately
  re-check a sample product's live price. If it snaps to correct, that
  plugin (or its interaction with the theme's patch) is confirmed as the
  cause despite the source reading above; if not, it's fully ruled out and
  the Wholesale For WooCommerce plugin's `inc/` code is the next place to
  read. This needs Dragon's go-ahead since it's a live production plugin
  toggle, even though brief and reversible.

**How to apply (updated):** the next session on this should start by
either (a) getting permission to do the deactivate-and-recheck test above,
or (b) reading through `woocommerce-wholesale-pricing/inc/` for a
`woocommerce_product_get_price` or `woocommerce_product_get_regular_price`
filter registration — that plugin is the one remaining major unexamined
piece. Don't re-investigate Erply, Wholesale plugin's *settings UI*, or
multi-currency again — all three are conclusively ruled out as of this
session.

**2026-08-14 — continued read-only source review, no site changes.** Per
Dragon's instruction ("don't touch anything, just make note"), kept
reading code, no deactivation/testing performed.

- **"Woocommerce Sale Discount Scheduler" now fully ruled out.** Read all
  4 of its PHP files (`functions.php`, `options.php`, `shortcodes.php`,
  `widgets.php`). Only one filter registration exists anywhere in the
  plugin (`woocommerce_product_get_price` in `functions.php`, covered
  above) and it only ever discounts scheduled products. `options.php` is
  just the product-edit-screen tab UI (matches what was seen live),
  `shortcodes.php`/`widgets.php` contain no price-value code at all
  (`get_price` doesn't appear in either). This plugin is not the cause.
- **Wholesale For WooCommerce's `inc/` is large (~30 files); checked the
  most price-suggestive ones so far, all clean:**
  - `class-wwp-wholesale-frontend.php` (73KB) — hooks
    `woocommerce_product_get_tax_class` (unrelated to amount) and
    `woocommerce_get_price_html` via `wwp_woocommerce_get_price_html()`,
    but that function just `return '';` (it's the "Hide Price" feature for
    restricted roles, not a multiplier). Also defines
    `wccs_hook_priorities_callback()` which sets
    `$priorities['woocommerce_product_get_price'] = 500` — this is
    compatibility scaffolding for a third-party "WCCS" plugin's priority
    filter and does nothing unless that other plugin is present and
    calls it (no such plugin found active on this site) — a dead code
    path here, not the cause.
  - `class-wwp-wholesale-general-functions.php` (102KB, the file with by
    far the most `get_price`/`get_regular_price` references) — registers
    **no filters at all**; it's a library of `tire_*`/`wholesale_*`
    tier-pricing calculation helpers (yes, "tire" — a typo for "tier"
    throughout this codebase) called only from templates when a product
    actually has tier rules configured. Since the sampled products have
    no tier rules (confirmed live earlier), these never run for them.
  - `class-wwp-wholesale-common.php`, `class-wwp-wholesale-bulk-price.php`
    — no `woocommerce_product_get_price` filter registration, no
    `get_regular_price` at all.
  - **Not yet checked:** `class-wwp-wholesale-rulesets.php`,
    `class-wwp-wholesale-backend.php`, `class-wwp-wholesale-groups.php`,
    `class-wwp-wholesale-user-roles.php`, `class-wwp-products-visibility.php`,
    the `api/` and `integrations/` subfolders, and everything under
    `build/` (compiled JS, unlikely to matter for a server-side price
    filter but not ruled out). `class-wwp-wholesale-rulesets.php` is the
    single most promising unchecked name — "rulesets" is exactly the kind
    of place a global default markup rule would live.

**How to apply (updated 08-14):** next session, start with
`class-wwp-wholesale-rulesets.php` — haven't found the actual
`woocommerce_product_get_price`/`woocommerce_product_get_regular_price`
registration anywhere in Wholesale For WooCommerce yet despite checking
~4 of its largest/most likely files, so it's either in one of the
not-yet-checked files above, or the deactivate-and-recheck test (still
pending Dragon's go-ahead) is genuinely the faster path from here.

**2026-08-14, continued (still read-only, no site changes) — FOUND THE
ACTUAL FILTER, but hit a real paradox that needs the next session's
attention.**

- `class-wwp-wholesale-rulesets.php` checked and ruled out — despite the
  name, it's only about custom user-registration form fields
  (`wwp_add_new_field`/`wwp_edit_new_field`/`wwp_save_new_field`), no
  price code at all.
- Also ruled out clean: `class-wwp-wholesale-groups.php`,
  `class-wwp-wholesale-user-roles.php`, `class-wwp-wholesale-backend.php`
  (178KB, the biggest file in the plugin), `class-wwp-hide-price.php`,
  `class-wwp-products-visibility.php`, `class-wwp-wholesale-metabox.php`,
  the main bootstrap file's full contents, and
  `inc/integrations/` (recaptcha only) — none reference
  `get_regular_price` or register a price-value filter.
- **`inc/api/v1/class-wwp-rest-api-wholesale-products-v1-controller.php`**
  does hook `woocommerce_rest_prepare_{post_type}_object` (the real
  WooCommerce REST hook that shapes `wc/v3/products` responses) via
  `add_wholesale_data_on_response()` — but read the function fully: it
  only *adds* a new `wholesale_data` key to the response for a specific
  internal "wholesale endpoint" request type, and returns early
  unchanged otherwise. Doesn't touch `regular_price`/`price` values.
  Ruled out.
- **THE ACTUAL FILTER, found in `inc/class-wwp-wholesale-multiuser.php`
  (118KB):** registers `wwp_regular_price_change()` at **priority 200**
  (i.e. runs *after* the Sale Discount Scheduler's priority-10 hook) on
  all four of: `woocommerce_product_get_price`,
  `woocommerce_product_get_regular_price`,
  `woocommerce_product_variation_get_price`,
  `woocommerce_product_variation_get_regular_price`. This is the first
  and only place in the whole codebase that hooks
  `get_regular_price` — it explains why *both* `price` and
  `regular_price` came back inflated identically in every API check.
  The function pulls the real base price fresh (`get_post_meta(
  $product_id, '_regular_price', true )` — i.e. genuinely reads $12) and
  computes a role/group-specific price via `$this->change_price( $price,
  $discount_type, $wholesale_price, $product_id )`, using per-product
  role data stored in postmeta key **`wholesale_multi_user_pricing`**.
- **Confirmed this specific product's role data is genuinely empty**,
  not just unchecked in one UI screen: the product edit screen has its
  own dedicated metabox (`id="wholesale-pricing-pro-multiuser"`, titled
  "Wholesale User Pricing" — a *third* place this same data surfaces,
  distinct from both `Wholesale → Bulk Wholesale Pricing` and
  `Wholesale → Settings → Wholesale Price Global` checked earlier).
  Read its Retail row's actual form field values directly via JS
  (`role_204` checkbox, `discount_type_204`, `wholesale_price_204`):
  unchecked, price blank — so it isn't stale per-product override data
  either.
- **The paradox: `wwp_regular_price_change()` explicitly bails out for
  REST requests.** Very first lines of the function:
  ```php
  if ( defined( 'REST_REQUEST' ) && REST_REQUEST ) {
      return $price;
  }
  ```
  This should mean `wc/v3` API calls (exactly how this bug has been
  measured every time, including the live 16-SKU checks) get the *raw,
  unfiltered* price back — contradicting every live measurement showing
  2.400x via the API. Two live options for next session to test (neither
  attempted — read-only only so far):
  1. **Stale transient/object cache theory (most likely):** the function
     calls `wc_delete_product_transients( $product->get_id() )` on every
     non-REST invocation (i.e. every real front-end page view), which
     forces WooCommerce to recompute and re-cache derived price data.
     If that recomputation path captures the filtered (2.4x) price into
     a transient that a later REST request reads without re-running the
     filter, front-end visits would be "poisoning" the cache that the
     REST API then serves stale — which would make the REST_REQUEST
     guard technically true but practically irrelevant. Testable by
     comparing a product that has *never* been viewed on the front end
     (freshly published, zero traffic) against one that has.
  2. There may be a second code path/registration not yet found that
     doesn't carry the REST_REQUEST guard — the `add_filter` list found
     8 `_get_price'` matches in this file; two were a *second*,
     differently-conditioned registration block calling the *same*
     `wwp_regular_price_change`, so it's unlikely to be a different
     function, but the guard/condition wrapping that second registration
     wasn't fully read.

**How to apply (updated 08-14, second pass):** this is now almost
certainly the right file/function
(`class-wwp-wholesale-multiuser.php::wwp_regular_price_change`), but the
REST_REQUEST early-return doesn't match observed behavior — that
contradiction, not "which plugin," is the open question for whoever picks
this up next. Fastest paths from here, in order: (a) the
deactivate-and-recheck test (still needs Dragon's go-ahead, but now
specifically deactivate **Wholesale For WooCommerce**, not the Sale
Discount Scheduler — that one is fully cleared), (b) find where the
function returns for the "no group, no per-role override" case (the code
after the point read so far wasn't reached) in case it has its own
non-guarded fallback multiplier, or (c) check whether a stale WooCommerce
price transient explains the REST/admin-form split per the cache theory
above.
