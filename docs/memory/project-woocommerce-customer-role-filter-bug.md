---
name: project-woocommerce-customer-role-filter-bug
description: wc/v3/customers defaults to role=customer and silently hides every Wholesale Suite-tiered account -- caused a false "import never landed" conclusion and one bad backfill run, 2026-08-07
type: project
---

**`GET wc/v3/customers` on this store silently excludes any user whose WP
role isn't the bare `customer` role.** Every Wholesale Suite tier role
(`default_wholesaler`, `chain`, `retail`, `exclusive`, `distributor`) is
excluded unless the request adds `&role=all`. Confirmed live 2026-08-07: the
same query without `role=all` reported 6 total customers; with it, 3,182.

**Consequence:** [[project-woocommerce-tier-mapping]]'s 2026-08-06 note that
"the third-party import never landed" was **wrong** — it was a false
negative from this filter, not an absent import. The import DID land
(customers created 2026-08-06T18:22 with role `default_wholesaler`, e.g.
`chris@zoofies.com`, `espie.fonseca@srpcompanies.com`). `scripts/check-woo-
customer-changes.mjs` (the script that produced the "still 6" reading every
time it was re-run) has been fixed to pass `role=all`; so have
`lib/woo.ts`'s `getWooCustomerByEmail`/`getAllWooCustomers` and
`scripts/backfill-erply-customers-to-woo.mjs`'s `fetchAllWooCustomers`.

**Real impact, 2026-08-07 session:** believing Woo was still empty, ran
`scripts/backfill-erply-customers-to-woo.mjs --apply` against what looked
like ~2,793 missing customers. 2,791 of 2,793 failed with
`registration-error-email-exists` (they already existed) — the only 2 that
succeeded were two throwaway `@example.invalid` test customers created
earlier in the same session while verifying Erply's `saveCustomer` shape.
Reverted immediately via `scripts/revert-erply-customers-to-woo-backfill.mjs`
using that run's own backup CSV — confirmed clean (`erply_woo_customer_links`
back to 0 rows, both test Woo accounts deleted). **No real customer data was
created, duplicated, or damaged** — the failed attempts were all no-ops
(Woo's own email-uniqueness check rejected them before anything wrote).

**Corrected real gap, computed after the role=all fix** (Erply 2,793 usable
unique-email customers vs Woo 3,182, diffed by lowercased email):
- **27 Erply emails missing from Woo** — sampled and most are NOT valid
  single emails, they're semicolon-joined multi-address fields Erply itself
  stores as one "email" value (e.g.
  `"sandra.chuquimarca@etafashion.com;melissa.granda@modarm.com"`). This is
  an Erply data-quality issue, not a sync gap — needs a human decision on
  how to split/handle before any script touches it, not a mechanical fix.
- **50 Woo emails not in Erply** — sample includes what look like the
  import team's own test accounts (`@automattic.com`, `@britecode.io`) mixed
  with what may be genuine organic signups (`carletonhughes@gmail.com`
  etc.) — needs a human pass to separate real signups from dev/test junk
  before bulk-creating any of them in Erply.

**Also noteworthy:** the Wholesale Suite `wp-json/wholesale/v1/roles`
endpoint's `count`/`total_users` field reads 0 for every role even with
3,182 real customers assigned across them — that field is not a live
`WP_User_Query` count, don't trust it as a signal of whether role assignment
happened.

**Why:** this cost one wasted (harmless, self-corrected) production write
and burned most of a session chasing a phantom "import never landed" gap
that was actually ~99% already closed.

**How to apply:** any future code touching `wc/v3/customers` — reads or
writes — MUST include `role=all` on list/lookup calls, or it will silently
undercount by ~3,176 accounts on this store. Before building anything that
assumes a WooCommerce customer/data gap, re-derive the real diff live (email
set difference) rather than trusting a raw endpoint count. The remaining
27/50-email edge cases are a scoping question for Dragon, not something to
auto-resolve.
