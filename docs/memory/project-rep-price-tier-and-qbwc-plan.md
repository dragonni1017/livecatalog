---
name: project-rep-price-tier-and-qbwc-plan
description: 2026-08-20 -- Feature 2 (rep price-tier ordering) built + verified, real rep account sale@ly-usa.com provisioned with working login/2FA; Feature 1 (QBWC) schema/qbXML/SOAP endpoint/.qwc file generator all built + verified; only remaining work is QBWC env vars and real hardware
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

**Still open for Feature 2:**
- No real order has been placed through `/rep/order` by the real
  `sale@ly-usa.com` account yet — only login/2FA were verified just now.
  The disposable-account order-placement test from earlier in this doc is
  still the only proof the submit path works, on a since-deleted account.
- `customers` table RLS is still off entirely (pre-existing gap, migration
  0012) — flagged in the plan as an optional independent fix, deliberately
  not bundled into this work.

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
