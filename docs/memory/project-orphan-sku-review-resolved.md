---
name: project-orphan-sku-review-resolved
description: 2026-08-05/06 -- the 143/146 Supabase-active-but-not-in-Erply SKUs flagged by preview-erply-sync.mjs are now investigated, all confirmed orphans, and hidden via manually_hidden; price-only sync from Erply is also live and confirmed in sync
type: project
---

Resolves the open warning in [[project-erply-pagination-fix]] ("143
deactivate-candidates still unreviewed, DO NOT enable sync yet").

**What ran, in order (all in `scripts/`, currently untracked/uncommitted):**
1. `sync-prices-only.mjs` — scoped Erply -> Supabase price push. Only writes
   `price_cents` on rows matched by SKU to an active Erply product; never
   inserts, deactivates, or touches stock_qty/image_url/category. Confirmed
   live 2026-08-06: 2,870/2,870 matched SKUs already correct, 0 updates
   needed (prices already in sync from an earlier run) — 146 Supabase
   products have no active-Erply match and are left untouched by design.
2. `investigate-mismatched-skus.mjs` (read-only) — checked each of those ~146
   mismatched SKUs against Erply: inactive-in-Erply vs. not-in-Erply-at-all
   vs. case-mismatch. Result: all 143 (of the 146) fell into the same
   "doesn't exist in Erply under any casing" orphan bucket — none were
   case-mismatches, none were Erply-inactive-but-real.
3. `hide-orphan-skus.mjs` — sets `manually_hidden = true` (not `is_active`,
   which is sync-owned per `lib/types.ts`) on those 143 orphans. Confirmed
   live 2026-08-06 via dry run: all 143 already `manually_hidden = true` (0
   newly hidden) — this step has already been applied, not just written.

**Current state (verified live 2026-08-06, not just from script comments):**
Erply/Supabase prices match exactly, the 143 orphans are hidden from the
public storefront but still `is_active = true` in the DB (reversible), and
~~`sync-prices-only.mjs` is safe to re-run anytime as a narrow price-only
sync.~~ **DELETED 2026-10-02:** `scripts/sync-prices-only.mjs` no longer exists. It still applied ×0.5
  after lib moved to `RETAIL_MULTIPLIER = 1` (2026-08-21), so `--apply` would have halved ~3,000
  live prices. For a price-only refresh use the "Pull prices from Erply now" button on
  `/admin/cleanup?issue=pricing` (it only fills $0 rows) or wait for the 08:00 UTC sync. Full `app/api/sync/route.ts` (insert/update/deactivate/categories) is
still NOT what's running — this is a hand-run narrow substitute, not the
real sync being enabled.

**Why:** `preview-erply-sync.mjs`'s original finding (146 active-in-Supabase
SKUs not in Erply's active feed) blocked enabling real sync because a full
sync would have deactivated all of them sight-unseen; this investigation
+ hide step reviewed them individually instead of blanket-deactivating.

**How to apply:** if asked "are Erply and the storefront prices in sync" or
"what happened to the 143/146 mismatched SKUs," this is resolved — don't
re-run the investigation from scratch, compare prices read-only
(the script this used to name is deleted, see above) to confirm current state, since it's cheap and doesn't trust
memory of a point-in-time snapshot. The full-sync-enablement blocker in
[[project-erply-pagination-fix]] is only about `stock_qty`/`image_url` now,
not the SKU-mismatch/deactivation risk.
