---
name: project-stock-sync-oscillation-20261021
description: 2026-10-21 — the Erply stock sync anchored at each run's START, so every Erply change was applied twice then reversed twice on a 6-night cycle (84 SKUs, 44 live; K229486 hit 0 every 6th night). Fixed by anchoring after the run's writes; self-heals by the 2026-10-23 run. Also: catalog 999 = June import placeholder, kept because Erply 0 is skipped
type: project
---

**The bug.** `syncStockFromErply` (lib/product-sync.ts) computes
`delta = erply_now - stock_qty_as_of(last_stock_sync_at)`. It stored
`last_stock_sync_at` as the run's START time, before its own
`adjust_stock()` writes. So the next night's baseline excluded those writes
and the same Erply change was applied again; then the baseline caught up one
night late and reversed it twice. Six-night cycle, e.g. FD400039 with a
steady 2,800 in Erply: catalog 1,000 → 2,800 → 4,600 → – → 2,800 → 1,000 → –.
Only products with an earlier `stock_adjustments` row are affected (with
none, `stock_qty_as_of_bulk` falls back to the current stock, which hides
it) -- i.e. everything the sync had touched once. On 2026-10-21 that was all
84 SKUs it adjusted since 09-25, 44 live; swings of ±1 (52 SKUs) up to
±6,000 (K229486: 0 / 6,000 / 12,000 against Erply's 6,000).

**Fix (PR #155):** anchor at max(our clock, newest
`stock_adjustments.created_at`) AFTER the writes -- the DB stamps
adjustments with its own clock, so our clock alone could land before them.
`tests/stock-sync.test.ts` simulates several nights; its products are seeded
with history because without it the bug doesn't reproduce.

**Recovery is automatic:** the first run after deploy still reads the old
start-anchor, the second converges. Expect the catalog to match Erply for
these SKUs from the **2026-10-23** run. Re-check with
`node scripts/audit-stock-vs-erply.ts`: the "different" count should drop to
roughly the Erply-0 group below.

**Not a bug, recorded so it isn't re-investigated:** 916 active products read
exactly **999**. That's the June placeholder from
`scripts/import-all-products.mjs`. 772 of them read 0 in Erply, and the stock
sync deliberately skips Erply 0 ("not counted yet", decided 2026-09-03), so
the placeholder never updates; 146 more aren't in Erply at all. 917 of the
918 are hidden. "994–999" is NOT the fake 1000 minus sales. See
[[project-fake-stock-1000-hold]].

**How to apply:** a catalog/Erply stock gap that is a clean multiple of an
Erply change is this bug's signature, not bad data -- check the SKU's
`stock_adjustments` history for alternating ± rows before touching data.

**Watched nightly since 2026-10-21 (PR after #155):** the cron records
`details.stockDrift` (lib/stock-drift.ts) -- counted Erply SKUs whose catalog
stock still differs after the sync -- and /admin/sync shows it above the run
table. Baseline on 10-21, before the fix took effect: **82 of 2,025 (42
live)**. The 10-22 run is transitional; from **10-23 it should be near 0**. If
it isn't, the fix didn't take.
