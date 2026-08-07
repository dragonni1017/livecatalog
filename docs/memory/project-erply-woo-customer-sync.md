---
name: project-erply-woo-customer-sync
description: daily bidirectional Erply<->Woo customer/tier sync built and live 2026-08-07; migration 0019 applied; real remaining gap is small (~27/50 emails), see project-woocommerce-customer-role-filter-bug for why
type: project
---

Built out the customer bridge that had been scaffolding-only since
2026-08-04 (see [[project-woocommerce-tier-mapping]]):

- **`supabase/migrations/0019_erply_woo_customer_links.sql` applied live**
  (project `aguorduaxfqrvvywgrdi`) — was never actually run before this
  session despite existing in the repo since 08-04. RLS enabled with no
  policies (service-role-only access, matches how it's actually used).
- **`lib/tier-mapping.ts`**: `Retail` (term_id 204) and `Exclusive` (term_id
  203) roles filled in — all 5 Erply tiers now map to real Wholesale Suite
  roles. Fetched live via `GET wp-json/wholesale/v1/roles`.
- **`lib/erply.ts`**: added `getErplyCustomerGroups`, `getErplyCustomers`
  (paginated, tier-resolved, dedupes by email keeping the first, skips
  no-email records), `createErplyCustomer` (classic API `saveCustomer`).
  Hand-verified live against two throwaway test customers before trusting it
  — response shape is `{records: [{customerID, clientID, alreadyExists}]}`,
  and `groupID` param correctly sets the tier (`groupName` came back
  `"Retail"` as expected).
- **`lib/woo.ts`** (new): shared WooCommerce customer client. **Must use
  `role=all` on every list/lookup call** — see
  [[project-woocommerce-customer-role-filter-bug]], this bit the first run
  hard.
- **`app/api/sync/customers/route.ts`** (new): daily cron (`vercel.json`,
  09:00, 1hr after the product sync). Full-pull-and-diff against
  `erply_woo_customer_links`, same shape as the existing `/api/sync`
  product route. Erply->Woo creates/role-updates; Woo->Erply creates new
  Erply customers defaulted to `DEFAULT_TIER` (Retail). Built but **not yet
  exercised against production** — the one real live run so far was the
  one-time backfill script below, not this cron route.
- **`scripts/backfill-erply-customers-to-woo.mjs`** + **`scripts/revert-
  erply-customers-to-woo-backfill.mjs`**: one-time catch-up + its undo path.
  First `--apply` run (before the role=all fix) attempted ~2,793 creates,
  2,791 correctly failed as already-existing (Woo's own uniqueness check
  caught it, zero real damage), only 2 succeeded — both were this session's
  own `@example.invalid` test customers, immediately reverted via the CSV
  backup log. `erply_woo_customer_links` confirmed back to 0 rows after
  revert.

**Real state after the role=all fix, computed 2026-08-07 by diffing actual
email sets (not endpoint totals):** Erply has 2,793 usable unique-email
customers, Woo has 3,182 (all under Wholesale Suite roles from the
third-party import that DID land 2026-08-06, contrary to the prior "never
landed" note). True gap: 27 Erply emails missing from Woo (mostly malformed
semicolon-joined multi-address fields, an Erply data problem) and 50 Woo
emails not in Erply (mix of the import team's own test accounts and
possibly-real organic signups) — both need a human triage pass, not a
mechanical script, before anything writes to either side again.

**Why:** Dragon asked to sync WordPress/Woo customers with Erply
bidirectionally, tier-aware, daily — this closes that out except for the
small edge-case list above.

**How to apply:** the cron route and backfill script are correct now (role=
all fixed) but the backfill script should NOT be re-run blindly — the
remaining 27/50 emails need Dragon's input on multi-email splitting and
which Woo-only accounts are real vs test junk before either direction
touches them. The daily cron is safe to enable as-is for the steady-state
trickle (new customers, tier changes) since it only acts on customers that
don't already have a link row or whose tier changed — re-confirm the cron's
first live run once enabled rather than assuming it behaves like the local
verification.
