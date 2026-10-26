---
name: project-import-stock-guard-20261022
description: 2026-10-22 (#162) — /admin/import (QuickBooks Excel) ignores Stock Qty for every SKU Erply counts, because the import REPLACES stock while the nightly sync ADDS Erply's change on top, so a delivery in both counted twice. Erply is the stock master; Erply unreachable → all Stock Qty ignored. Never run on live as of 2026-10-26
type: project
---

**The double count.** The import replaces `stock_qty` with the sheet's
figure. The nightly Erply stock sync is delta-anchored (see
[[project-stock-sync-oscillation-20261021]]): it adds each night's Erply change
on top of whatever the catalog holds. A delivery that is in both the
QuickBooks sheet and Erply was counted twice: 1,000 on hand + 500 arriving →
sheet sets 1,500, Erply goes 1,000 → 1,500, the sync adds +500 → catalog 2,000.

**Decision (2026-10-22): Erply is the stock master.** `lib/import-stock.ts`
blanks the sheet's Stock Qty for every SKU Erply counts at warehouse 1. A
blank means "keep what's stored" (`keepExistingWhenBlank`); on a brand-new
product it means 0, which the next sync takes to Erply's count. Only SKUs
Erply has never counted take stock from the sheet, and the sync leaves those
alone, so they can't double either. If Erply can't be read, every Stock Qty is
ignored. Failing open would bring the double count back exactly when nobody
can see it. Other columns (name, price, description...) import as before.

"Counted" depends on #161's `isErplyCounted`. Erply sends `totalInStock` as a
decimal string, and before #161 the counted set was wrong.

**Status 2026-10-26.** `import_runs` is empty: the website import has never
been run on live, so the guard is unit-tested only. On the first real import,
the preview's "N Stock Qty values ignored" should cover nearly every row
(Erply counts ~2,190 products). A small number means the counted set failed
to load. Ops handoff: the "Excel import from QuickBooks" section of the
Receiving & Pricing Handoff doc.
