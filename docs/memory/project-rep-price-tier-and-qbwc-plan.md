---
name: project-rep-price-tier-and-qbwc-plan
description: 2026-08-20 -- Feature 2 rearchitected to header-dropdown tier browsing, THEN a critical price_tiers bug found+fixed same day (percentages were relative to Retail but the stored base price is actually Wholesale -- see the CRITICAL BUG section); Feature 1 (QBWC) all built + verified, only QBWC env vars + real hardware remain
type: project
---

**Full approved plan lives outside the repo** at
`C:\Users\Dragon\.claude\plans\synthetic-greeting-blum.md` (a Claude Code
plan-mode artifact, not committed to git) — read it before continuing either
feature; this node is a pointer + the decisions/state that plan file itself
won't stay in sync with as work progresses.

**Two features, both stemming from a 2026-08-20 planning session:**
1. Internal sales-rep login accounts that pick a named price tier
   (Wholesale/Retail/Distribution-Chain/Exclusive/Base) to price an order for
   a customer, replacing the flat, invisible `customers.discount_percent`
   used today only by the public checkout path.
2. Auto-entering approved orders into QuickBooks Desktop via Intuit's
   QuickBooks Web Connector (QBWC) — a Windows-side polling SOAP client,
   since QB Desktop has no cloud API. Core build done (schema, qbXML
   builders, full SOAP endpoint) and verified end-to-end against the real
   DB with a simulated QBWC session — see below. Still needs real hardware.

**Locked-in decisions (confirmed with Dragon, don't re-litigate without
asking again):**
- Reps get a **dedicated `/rep` section**, not an extension of the public
  cart/checkout.
- Rep login requires **2FA (TOTP)**, same mechanism as admin but a
  **separate secret** — `REP_TOTP_SECRET` env var, distinct from
  `ADMIN_TOTP_SECRET`, so the two credentials never cross-authorize.
- When a rep selects a tier for an order, **it overrides** the customer's
  own file `discount_percent` for that order — never stacked.
- Marking an order **"Converted" automatically enqueues it for QB sync**
  (not a separate manual "Send to QuickBooks" click) — Dragon confirmed
  this explicitly even after being shown the tradeoff (a mis-click on
  status now has a real downstream side effect). Implemented: the
  `qb_sync_queue.order_id` unique constraint + `ON CONFLICT` handling in
  `app/admin/api/orders/route.ts` makes the enqueue idempotent — re-saving
  "converted" on an already-queued order never creates a duplicate sync
  attempt.

**What's actually landed as of 2026-08-20 (Feature 2, partial):**
- `supabase/migrations/0028_price_tiers.sql` — `price_tiers` table, 5 rows
  seeded (retail 0%, wholesale 50%, distribution_chain 54%, exclusive 38%,
  base 0%) — percentages sourced from
  [[project-retail-anchor-pricing-flip]], not re-derived.
- `supabase/migrations/0029_order_rep_tier.sql` — adds
  `order_requests.rep_user_id` (FK to `auth.users`), `applied_tier_code`
  (FK to `price_tiers`), `applied_tier_discount_percent` (numeric snapshot,
  same rationale as `order_items.unit_price_cents` snapshotting — a later
  edit to `price_tiers.discount_percent` must never rewrite what a past
  order was actually priced at).
- `supabase/migrations/0030_submit_order_rep_tier.sql` — extends
  `submit_order()` with 3 new optional params. **Had to `drop function`
  the old 10-arg signature explicitly first** (a new-signature
  `create or replace` alone creates a second overload, not a replacement)
  and re-run the `revoke/grant/search_path` lock-down from
  `0025_lock_down_definer_functions.sql` against the new 13-arg signature —
  if this pattern is needed again for another `security definer` function,
  see 0030 as the worked example.
- `middleware.ts` — new `/rep` gate mirroring the admin gate
  (`app_metadata.role === 'rep'`), placed before the `/api` bypass so
  `/rep/api/*` inherits it automatically.
- `app/api/rep/auth/route.ts` + `app/rep/login/page.tsx` — near-duplicates
  of the admin login route/page with the role swapped to `'rep'` and the
  TOTP secret swapped to `REP_TOTP_SECRET`.
- `app/rep/page.tsx` — placeholder landing page only (shows the logged-in
  rep's email + the live `price_tiers` table). **Not the order-builder.**
- `lib/order-rules.ts` — added `applyTierDiscount(cents, discountPercent)`,
  a pure function shared between client (future rep price preview) and
  server. `app/api/orders/route.ts`'s existing customer-discount math was
  refactored to call this same function instead of inlining the rounding,
  so there's now exactly one discount-rounding implementation in the repo.
- `lib/types.ts` — `OrderRequest` interface updated with the 3 new columns.
- `lib/order-submission.ts` (new) — `buildLineItems`/`nextReferenceCode`/
  `insertOrder` extracted out of `app/api/orders/route.ts`, shared by both
  the public and rep order paths so the two can't independently drift on
  discount math.
- `app/rep/order/page.tsx` + `components/rep/RepOrderBuilder.tsx` — the
  actual order-builder: tier dropdown, SKU quick-add (reuses
  `/api/products/lookup`), live tier-adjusted price preview via
  `applyTierDiscount`, customer contact form, submit.
- `lib/rep-cart-context.tsx` — separate client-side cart (own localStorage
  key `livecatalog_rep_cart_v1`) so a rep's in-progress order never
  collides with a public shopper's cart in the same browser.
- `app/rep/api/orders/route.ts` — validates the submitted `tierCode`
  server-side against `price_tiers` (never trusts a client-supplied
  percent), skips the `customers.discount_percent` lookup entirely (tier
  overrides, per the locked-in decision), auto-fills `placed_by_rep` from
  the verified session email.
- `app/rep/2fa-setup/page.tsx` — mirrors `/admin/2fa-setup` exactly, reads
  `REP_TOTP_SECRET`.
- **Verified end-to-end 2026-08-20**: created a disposable rep account
  (`app_metadata.role='rep'`), logged in via the real `/rep/login` UI in a
  browser, placed a real order through `/rep/order` (Wholesale tier, 2
  SKUs), confirmed via direct DB query (not the UI's success message) that
  `subtotal_cents`/`rep_user_id`/`applied_tier_code`/
  `applied_tier_discount_percent`/`placed_by_rep` all landed correctly,
  then deleted the test order + test auth account. Nothing left behind.

**Real rep account provisioned + verified 2026-08-20**: `sale@ly-usa.com`
(`app_metadata.role='rep'`), created via a one-off script using the
Supabase Auth admin API (script deleted after, account is permanent).
Password was Dragon's own choice, given directly in chat — not generated
or retained by Claude, unlike the disposable test account. Logged in for
real via `/rep/login`: password accepted, then prompted for a 2FA code
(confirms **`REP_TOTP_SECRET` has since been set** by Dragon himself,
resolving the "not yet set" gap from earlier in this doc — Claude computed
a valid TOTP code in-session from the known secret value
`D4WTIEIYVY6ZFRLZXTFKZSK` to verify the challenge, since no authenticator
app was scanned in this session) — landed on `/rep` as
"Signed in as sale@ly-usa.com". Login + 2FA are both confirmed genuinely
working end-to-end, not just built.

**Still open for Feature 2 (as of the original order-builder design):**
- `customers` table RLS is still off entirely (pre-existing gap, migration
  0012) — flagged in the plan as an optional independent fix, deliberately
  not bundled into this work.

---

**REARCHITECTED same day, 2026-08-20, after real-account testing.** Dragon
asked for a different UX: instead of a separate `/rep/order` page with
manual SKU entry, reps should browse the *regular* public storefront (same
product grid, category pages, product detail pages every shopper sees),
with a tier dropdown in the header that changes displayed/charged prices
live. Two decisions locked in when asked:
- **Replaces** (not sits alongside) the old `/rep/order` quick-SKU tool —
  that page, `components/rep/RepOrderBuilder.tsx`, `lib/rep-cart-context.tsx`,
  and `app/rep/api/orders/route.ts` are all **deleted**.
- Reps use the **same** `/cart` page and `AddToCartButton` as public
  shoppers — `app/api/orders/route.ts` (the one public order-submit route)
  became tier-aware itself, rather than keeping a second rep-only endpoint.

**Critical design constraint discovered mid-build**: the product detail
page has `export const revalidate = 600` (10-min ISR) and `ProductCard` is
rendered on every catalog page — reading `cookies()`/`getSessionUser()`
anywhere in that server-rendered tree (which was the first, wrong instinct)
forces the **entire** route dynamic for **every visitor**, not just reps,
since a dynamic API used in a layout/page opts the whole request out of
static/ISR rendering in the Next.js App Router. Fixed by moving ALL
rep-detection and tier-selection logic to the **client**:
- `TierSwitcher` checks the session itself via `getAuthClient()` (same
  pattern as `AccountNav`), not a server-side check in the layout — renders
  nothing until it confirms `role==='rep'`.
- The tier choice lives in a plain (non-httpOnly) cookie (`rep_tier`,
  `lib/rep-tier-shared.ts`'s `TIER_COOKIE`), read **client-side only** by
  `lib/use-tier-discount.ts`'s `useTierDiscount()` hook — used by
  `ProductCardPrice`, `ProductDetailPrice`, and `AddToCartButton` (now
  accepts an optional `tiers` prop).
- Changing the tier dispatches a `window` custom event
  (`TIER_CHANGE_EVENT`) rather than relying on `router.refresh()` — every
  price on the page updates instantly, no server round trip.
- `lib/rep-tier.ts`'s `getActivePriceTiers()` (a plain DB read, no
  cookies()) is still called server-side in the layout/ProductCard/detail
  page to fetch the tiers *list* — that's fine under ISR, since it's not a
  dynamic API, just data.
- The actual charged price is **still fully server-verified** in
  `app/api/orders/route.ts`: reads `request.cookies.get('rep_tier')`
  (Route Handlers are always dynamic already, no ISR concern there),
  confirms a real `role==='rep'` session, looks the tier's discount up
  fresh from `price_tiers`, and only then applies it — a forged cookie on
  a non-rep browser can only mislead what that browser displays to itself,
  never what an order is actually priced at.

**Verified end-to-end 2026-08-20 in the browser** using the real
`sale@ly-usa.com` account (password-only this time, 2FA still active since
Dragon hadn't removed `REP_TOTP_SECRET` yet — a fresh TOTP code was
computed in-session from the known secret same as before):
- Anonymous/logged-out view: unchanged — no dropdown, base prices. Confirms
  the client-side-only design doesn't affect non-rep traffic.
- Logged in as rep → redirected straight to `/` (not `/rep` anymore).
  Header shows "Rep pricing: Select tier…" + the rep's email (links to
  `/rep`, now just an account/2FA-setup/sign-out page, not the order tool).
- Selected Wholesale → **every product card's price updated instantly**
  (e.g. $2.50→$1.25 with the original struck through), confirmed exactly
  50% off across multiple products.
- Product detail page (`/product/prod-00005`) showed the same tier-adjusted
  price + strikethrough. (No live product currently has `volume_tiers` set,
  so the volume-tier-table branch of `ProductDetailPrice` couldn't be
  exercised live — code-reviewed instead, mirrors the already-verified
  single-price branch closely.)
- Added a tier-priced item to the **real public `/cart`**, submitted a real
  order through it. **Confirmed via direct SQL** (not the UI's success
  message): `subtotal_cents=175` (exactly 50% of $3.50),
  `placed_by_rep='sale@ly-usa.com'` (server-overrode the blank form field
  from the verified session), `rep_user_id` correctly linked,
  `applied_tier_code='wholesale'`, `applied_tier_discount_percent=50.00`.
  Test order deleted after.
- `npm run build` production build completed clean with no client/server
  boundary errors; confirmed via grep that `cookies()`/`next/headers` is
  never invoked from any ISR-cached catalog file, only from
  `app/api/orders/route.ts` (already `force-dynamic`).

**Still open for Feature 2 (current design):**
- `customers` table RLS is still off (same pre-existing gap as before).
- The product-detail volume-tier-pricing branch is code-reviewed but not
  live-verified (no product currently has `volume_tiers` set).
- Dragon asked separately whether 2FA could be turned off (not removed) —
  answer given: unset `REP_TOTP_SECRET` in `.env.local` + Vercel, the code
  already falls back to password-only automatically when that env var is
  absent, same toggle mechanism as `ADMIN_TOTP_SECRET`. **Since resolved**
  — confirmed working live (password-only login, no 2FA prompt) later the
  same day.
- Also since resolved: reference codes now carry the tier, e.g.
  `ORD-2026-0011-WHOLESALE` (public/non-rep orders keep the plain
  `ORD-2026-0011` format) — see `nextReferenceCode()` in
  `lib/order-submission.ts`. And the admin orders list/detail/print pages
  now show the applied tier (amber badge + "(X% off)"/"(X% markup)" line),
  which they didn't originally.
- Added `/admin/rep-accounts` (not `/admin/reps` — that path was already a
  rep-performance analytics page keyed off the free-text `placed_by_rep`
  field, a different concept) for listing/creating/deactivating/deleting
  rep login accounts, since there was previously no in-app way to manage
  them at all.

**CRITICAL BUG FOUND + FIXED 2026-08-20, same day, after the feature had
already shipped:** the `price_tiers` percentages from `0028_price_tiers.sql`
were wrong. They were set assuming the app's displayed base price
(`products.price_cents`) represents the **Retail** anchor (so Wholesale =
50% off it, Retail = 0% off it, etc.) — but `lib/erply.ts`'s sync
(`WHOLESALE_DISCOUNT = 0.5`, line ~58) already multiplies Erply's Retail
price by 0.5 before writing it to Supabase. **The app's stored/displayed
base price is already the Wholesale price, not Retail.** This was a
pre-existing 2026-08-06 decision (see
[[project-storefront-wholesale-quarter-rounding]]) that should have been
re-checked before designing the tier feature, not assumed.

Real-world impact before the fix: selecting "Wholesale" in the rep
dropdown applied an *extra* 50% off an already-wholesale price (customers
would've been quoted ~25% of real Retail); selecting "Retail" showed the
Wholesale price unchanged (labeled as Retail, ~50% too cheap).
Fixed via `supabase/migrations/0032_fix_price_tier_percentages.sql`,
re-deriving each tier's percentage **relative to the stored Wholesale
base** instead of relative to Retail:
- Wholesale: 0% (the stored base already *is* Wholesale)
- Retail: **−100%** (a 2× markup — `applyTierDiscount()` already handled
  negative percentages as markups correctly, `lib/order-rules.ts`, this
  was purely a stored-value bug, not a formula bug)
- Distribution-Chain: **8% off** (was 54% off)
- Exclusive: **−24%** (a 1.24× markup; was 38% off)
- Base: **deactivated** (Dragon's choice) rather than guessed — it predates
  the 2026-08-04 retail-anchor pricing flip and has 0 customers in Erply,
  so there's no live reference price to derive a correct value from.
  `getActivePriceTiers()` filters to `active=true`, so it no longer
  appears in the rep dropdown at all.

Also widened the `price_tiers.discount_percent` CHECK constraint from
`0-100` to `-100-100` (was blocking negative/markup values entirely), and
added `formatTierAdjustment()` to `lib/order-rules.ts` (used in the rep
tiers table, admin order detail, and admin order print pages) so a markup
displays as "X% markup" instead of the check silently omitting it or
misreading as "X% off".

**Verified live** with the real `sale@ly-usa.com` account against SKU
`3D801158` (Mermaids, $3.50 stored base): Wholesale → $3.50 (no
strikethrough, correct — it's the unadjusted base), Retail → $7.00 exactly
(2×), Distribution-Chain → $3.22 exactly, Exclusive → $4.34 exactly. All
four matched hand-calculated expected values precisely.

**How to apply:** before ever changing `price_tiers` percentages again,
re-derive them relative to what `products.price_cents` *actually* stores
(currently Wholesale, per `lib/erply.ts`'s `WHOLESALE_DISCOUNT`), not
relative to Erply's Retail anchor — those are two different bases and
conflating them is exactly what caused this bug. If the 2026-08-06
Wholesale-as-storefront-base decision is ever reversed, every value in
`price_tiers` needs to be re-derived again from scratch.

**Feature 1 (QBWC) — core built and verified 2026-08-20, real hardware
still pending.** Built in this session, scoped deliberately to "everything
testable without Dragon's QB Desktop machine" (his explicit choice over
building the `.qwc` file + doing a live hardware test in the same pass):
- `supabase/migrations/0031_qbwc_sync.sql` — `qb_sync_queue` (unique on
  `order_id`, the idempotency backbone), `qb_customer_links`,
  `qb_item_links`, `qb_sessions`. Applied and verified live (table
  existence confirmed via `information_schema.tables`).
- `qb_sessions` schema **deviates from the original plan file** — swapped
  the plan's `cursor_position int` / `order_ids_snapshot jsonb` for
  `pending_request_kind` / `pending_order_id` / `pending_ref` instead. The
  plan was written before the actual state-machine need was concrete:
  `receiveResponseXML` gets no context about what it's a response *to*, so
  the session row has to remember what the last `sendRequestXML` call
  asked QuickBooks for (a customer lookup, an item lookup, or the real
  SalesOrderAdd) so the response can be parsed correctly.
- `lib/qbxml.ts` (new) — pure qbXML builders (`buildCustomerQueryRq`,
  `buildItemQueryRq`, `buildSalesOrderAddRq`) and parsers
  (`parseCustomerQueryRs`, `parseItemQueryRs`, `parseSalesOrderAddRs`),
  using `fast-xml-parser` (new dependency — first XML/SOAP tooling in this
  repo). 12 unit tests in `tests/qbxml.test.ts`, all passing.
  **Field-mapping assumption, not yet verified against a real company
  file**: QuickBooks `CustomerQueryRq` has no email filter (only
  Name/ListID), so customer lookup is by name
  (`customer_company` falling back to `customer_name`) — `qb_customer_links`
  is still keyed by email (our own join key), just populated via a
  name-based QB-side lookup. Item lookup assumes QuickBooks item Name ==
  our `products.sku`.
- `app/api/qbwc/route.ts` (new) — the full SOAP endpoint: hand-rolled
  envelope parse/dispatch (not a generic `soap` npm package — those assume
  an always-on `http.Server`, which doesn't fit a Next.js route handler),
  all 8 required QBWC methods (`serverVersion`, `clientVersion`,
  `authenticate`, `sendRequestXML`, `receiveResponseXML`,
  `connectionError`, `getLastError`, `closeConnection`). SOAP envelope
  shapes were verified against real Intuit/ASP.NET reference examples via
  web search mid-session (namespace `http://developer.intuit.com/`,
  `authenticate` returns a 2-string array, `sendRequestXML`'s company-file
  param is literally named `Country` not `qbXMLCountry` as commonly
  mis-documented) rather than built from memory alone.
- Enqueue trigger wired into `app/admin/api/orders/route.ts`'s PATCH
  handler: status → `converted` inserts into `qb_sync_queue`
  (idempotent via the unique constraint), logs `order_qb_enqueued` to
  `audit_log` (new badge color added in `app/admin/audit-log/page.tsx`).
  `entered_in_qb`/`entered_in_qb_at` (migration 0005) now get set only by
  a confirmed `receiveResponseXML` success — never optimistically. The
  existing manual `EnteredInQbToggle` PATCH stays as an escape hatch.
- **Verified end-to-end 2026-08-20** with a from-scratch probe script
  (written to `scripts/_probe-qbwc-flow.mts`, run via `tsx`, then
  deleted — not part of the permanent suite since it hits the real prod
  DB): inserted a disposable test order, ran the full session
  (`authenticate` → `sendRequestXML` → `receiveResponseXML` × 3 with
  hand-built QuickBooks-shaped response XML → `sendRequestXML` returning
  empty → `closeConnection`), then confirmed via direct SQL that
  `qb_customer_links`/`qb_item_links` were populated, `qb_sync_queue.status`
  reached `'acked'`, and `order_requests.entered_in_qb` flipped `true` —
  the entire bootstrap-then-SalesOrderAdd state machine works correctly.
  All test rows deleted afterward.
- **Real bug caught and fixed during this verification pass**:
  `handleAuthenticate` originally didn't check whether the `qb_sessions`
  insert actually succeeded — a DB failure would have handed out a ticket to
  QBWC that didn't exist in the table, silently breaking every subsequent
  call in that session (since `getSession` would just return null forever).
  Now checks the insert's error and fails the handshake (`nvu`) instead.

**`.qwc` config file generator — built and verified 2026-08-20:**
- `app/admin/api/qbwc/qwc-file/route.ts` (new) — generates the `.qwc` XML
  on demand from `QBWC_USERNAME`/`QBWC_FILE_ID` env vars + the request's
  own origin (so downloading it from the live site always points QBWC at
  the live `/api/qbwc` endpoint, no hardcoded URL to drift). Returns 400
  with setup instructions if the env vars aren't set yet. Under `/admin`,
  so already gated by the admin cookie via `middleware.ts` — confirmed live
  (unauthenticated request redirects to `/admin/login?from=...`).
- `app/admin/quickbooks/page.tsx` (new) — status/instructions page mirroring
  `/admin/2fa-setup`'s pattern: shows which of `QBWC_USERNAME`/
  `QBWC_PASSWORD`/`QBWC_FILE_ID` are set (booleans only, never values) and
  either setup steps or a working download button. Linked from the admin
  dashboard.
- **Verified via a disposable probe script** (written, run via `tsx`, then
  deleted — no DB involved so no cleanup needed there): confirmed the
  "not configured" 400 JSON response, and with env vars set in-process
  only, confirmed the generated XML has the correct `AppURL` (derived from
  origin), `UserName`, braced-GUID `OwnerID`/`FileID`, and
  `IsReadOnly=false`.
- `QBWC_FILE_ID` **must be a stable value, generated once and never
  regenerated** — QBWC uses `OwnerID`/`FileID` to recognize "this is the
  same app I already registered" across re-imports; regenerating it
  desyncs from whatever's already configured in the Windows machine's QBWC
  UI. A candidate GUID was generated during verification
  (`ae9ce3c0-151f-4f9b-9292-bb6e43fbcde0`) but was only used as test-script
  input, never set anywhere real — Dragon should generate his own via the
  command shown on `/admin/quickbooks` (or reuse that one, doesn't matter
  which, as long as whichever is chosen is set once and kept forever).

**Still open for Feature 1 — only these three things now:**
1. `QBWC_USERNAME`/`QBWC_PASSWORD`/`QBWC_FILE_ID` env vars are not set
   anywhere — same "Claude can't write `.env.local`" limitation as
   `REP_TOTP_SECRET`. `/admin/quickbooks` has the exact steps once Dragon is
   ready.
2. Real QuickBooks Desktop + Web Connector install and a live hardware
   test — inherently can't be done in this session. Per the plan: point the
   first real run at Intuit's sample company file, not Dragon's live one,
   and manually verify the created Sales Order in QuickBooks itself before
   trusting anything — don't rely on `qb_sync_queue`'s own status column as
   proof.
3. Duplicate-send handling (QBWC retrying `sendRequestXML` after a dropped
   conversation) is handled at the "don't re-pick a `sent` row" level via
   `qb_sync_queue.status`, but hasn't been tested under an actual dropped
   connection — flagged in the plan as the single highest-risk failure mode
   given sync is automatic-on-Converted. Worth watching closely during the
   first real hardware test.

All code-level work for Feature 1 is done — everything left is
configuration (env vars) and the physical hardware step.

**Why:** so a future session picking this up doesn't have to re-derive the
override-vs-stack decision, the 2FA/secret split, or why `submit_order()`
needed an explicit `drop function` — none of that is visible from reading
the current schema alone, and the plan file itself lives outside git.

**How to apply:** before resuming either feature, re-read the plan file at
the path above for full detail this node intentionally doesn't duplicate.
Update *this* node (not just the plan file) as work continues, since the
plan file won't be kept in sync — treat it as a frozen snapshot of the
approved design, and this node as the living "what's actually done" status.
