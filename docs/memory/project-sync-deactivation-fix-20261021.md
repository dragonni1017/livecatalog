---
name: project-sync-deactivation-fix-20261021
description: 2026-10-21 — the Erply sync's "deactivate products not in Erply" step had NEVER worked (35 KB NOT IN URL -> 400, error dropped) and its single-quoted list would have deactivated the whole catalog on a short feed; rewritten with a 10% cap; first run deactivates 146 incl. T641519/T641730
type: project
---

`syncToSupabase` step 6 used `.not('sku', 'in', "('A','B',...)")` over every
incoming SKU. Two bugs, both verified live 2026-10-21 with read-only SELECTs:

- **~3,200 SKUs = a 35 KB URL; PostgREST returned 400 and the error was
  ignored**, so every run reported `deactivated: 0`. 146 active products
  not in Erply's active feed (144 hidden August orphans, plus T641519 and
  T641730, visible) were never deactivated.
- **Single quotes are part of the value to PostgREST**: 3 quoted SKUs
  matched 0 rows, unquoted matched 3. So a feed short enough to fit in a URL
  (e.g. Erply's 200-per-page cap truncating a fetch, seen before) would have
  deactivated EVERY active product.

**DECIDED by Dragon 2026-10-21: deactivate, with a cap.** Now
`planDeactivation` (pure, shared with `previewSync`) picks the SKUs in JS,
exact match, and refuses when more than max(20, 10% of active) would go; a
refusal is a run error (status partial) and nothing is deactivated. Writes
go by SKU in chunks of 200, errors reported per SKU. The deactivated SKUs
are stored in `sync_runs.details.deactivated` and listed on /admin/sync.

**Expected:** the first nightly run after the deploy (2026-10-22, 1 AM PT)
deactivates exactly 146 (dry run: Erply 3,215, active 3,361, limit 336).
After that, a handful at most. This supersedes the "keep orphans
is_active, hidden" state in [[project-orphan-sku-review-resolved]] and the
"T641519/T641730 stay visible" note in [[project-erply-sync-live-20261016]].
To bring a product back: add it to Erply (the sync's upsert sets
is_active from the feed), not a catalog edit.
