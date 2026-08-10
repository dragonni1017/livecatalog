---
name: project-woo-role-write-fix
description: 2026-08-10 -- scripts/assign-woo-tier-roles.mjs's --apply path silently did nothing (wc/v3 role field is read-only); fixed via a new WP_ADMIN_APP_PASSWORD credential and wp/v2/users writes
type: project
---

**What happened:** `scripts/assign-woo-tier-roles.mjs` (built out 2026-08-06,
see [[project-woocommerce-tier-mapping]]) had never actually been exercised
against a row that needed a real role change until 2026-08-10 — every prior
dry run found 0 customers needing a change. The first real `--apply` run (3
rows) reported "3 updated, 0 failed," but re-fetching live afterward showed
**none of the 3 had actually changed role.**

**Root cause:** `role` on WooCommerce's `wc/v3/customers` REST resource is
**read-only**. A `PUT` with `{ role: "retail" }` returns `200 OK` and silently
drops the field — no error, no indication anything was ignored. The only
route that can actually write a WordPress user's role is core's
`wp/v2/users/{id}`, via a `roles` array (plural) — and `WOO_CONSUMER_KEY`/
`WOO_CONSUMER_SECRET` (WooCommerce API keys) are **not valid credentials
there**: they only authorize `wc/v3/*` and get `401 rest_cannot_edit_roles`
on `wp/v2/*`.

**Fix, applied 2026-08-10:**
1. Generated a WordPress **Application Password** for the `conglai` admin
   account (Users → Profile → Application Passwords in `wp-admin` — this is
   a distinct credential system from WooCommerce's REST API keys). New env
   vars `WP_ADMIN_USERNAME=conglai` / `WP_ADMIN_APP_PASSWORD=...` added to
   `.env.local` and documented in `.env.example` (which is itself
   gitignored by the blanket `.env*` rule, so that edit doesn't show up in
   git — it's local-reference only).
2. `setWooCustomerRole()` in `scripts/assign-woo-tier-roles.mjs` rewritten
   to `PUT wp-json/wp/v2/users/{id}` with `{ roles: [slug] }` using the new
   `wpAdminAuthHeader()`, confirmed a WooCommerce customer's `wc/v3` `id`
   equals their WP user id (registered customers are WP users, no extra
   lookup needed).
3. The function now **re-fetches the user after writing and throws if the
   role didn't actually change** — same "don't trust a 200 response alone"
   lesson as the `saveProduct` incident in
   [[project-retail-anchor-pricing-flip]]. A future regression on this path
   will surface as a thrown error, not a silently-wrong success log.
4. Verified live end-to-end on the throwaway
   `claude-backfill-test-tier-*@example.invalid` account (id 3188) before
   touching real customers: `customer` → `retail`, confirmed by independent
   re-read. Then ran for real: **2 real customers** (`alfredtaylor983@hotmail.co.uk`,
   `jamees364bryant@gmail.com`) moved `customer` → `retail`, both confirmed
   live by the script's own built-in verify step. The 2
   `administrator`-role matches (`conglai@ly-usa.com`, shared by two
   different Erply customer records) remain correctly excluded via
   `NEVER_TOUCH_ROLES`, untouched.

**Also found/fixed while here:** `data/woo-tier-review/` and
`data/price-quarter-round-review/` (customer emails / pricing data) and
root-level `export-out/` were sitting untracked-but-not-gitignored, despite
this project's established convention (`.gitignore` lines ~56-65) of
gitignoring every `data/*-review/` scratch folder. Added all three to
`.gitignore` — not committed, just stopped being a `git status` trap.

**Why:** Dragon asked to finish/apply the tier-role sync that had been
sitting as an unfinished dry run since 2026-08-07; this was blocking on a
credential category (WP Application Passwords) that had never been set up
for this project before.

**How to apply:** any future code that needs to write a WordPress user's
`roles` (not just this script) must use `wp/v2/users` with a WP
Application Password — `wc/v3/customers`'s `role` field can be read for
display but never trusted to write. If `WP_ADMIN_APP_PASSWORD` ever needs
rotating, regenerate from the same `conglai` profile page (old ones can be
individually revoked there too) and update `.env.local` — no code change
needed since the script reads it from env. The 372 Erply customers with no
Woo email match are unchanged by this fix (that's a separate email/data-gap
question, not a role-writing problem) — see [[project-erply-woo-customer-sync]]
for that gap's history.
