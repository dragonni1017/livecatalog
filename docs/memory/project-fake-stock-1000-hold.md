---
name: project-fake-stock-1000-hold
description: 2026-09-17 — CONFIRMED against Erply: the fake 1000 is in Erply itself, on 1,881 of 3,076 active SKUs, not just stale catalog data; Dragon's call is still to leave it alone
type: project
---

Counted live 2026-09-16: **1,879 of 3,225 products have `stock_qty` of exactly
1000**. 994 have a real-looking non-zero quantity and 352 are at zero. That
matches the ~2,074 SKUs deliberately set to a fake stock of 1000 in Erply as a
connectivity test on 2026-08-17 (see [[project-erply-pagination-fix]]), whose
revert path was written but never run.

**DECIDED by Dragon 2026-09-16: do not adjust it yet.** Not an oversight and
not a task to pick up unprompted.

**CONFIRMED AGAINST ERPLY 2026-09-17** (`node scripts/audit-stock-vs-erply.ts
[--csv]`, report-only): the fake value is **in Erply itself**, not stale
catalog data a sync would clear.

| | |
|---|---|
| Catalog rows reading exactly 1000 | 1,879 — **all 1,879 read 1000 in Erply too** |
| Erply SKUs reading exactly 1000 | **1,881 of 3,076** active, i.e. 61% |
| Catalog vs Erply disagree at all | 792 of 3,076, median gap 999 |
| Catalog rows with no Erply record | 149 |

So a sync will not fix it, and receiving will build on top of it.

Also surfaced by that comparison, and separate from the 1000 story: `D701005`
through `D701008` read **3,120 in the catalog and 0 in Erply** (all hidden),
the largest divergences in the catalog.

A trap in writing that comparison, worth not repeating: **Erply returns stock
as a string** (`"1000.000000"`). The first run compared it with `=== 1000`,
which failed for every row, and reported the exact opposite conclusion —
"only the catalog is stale" — while printing `erply 1000.000000` beside it.
Coerce with `Number()`.

**Why it still matters:** receiving *adds* to whatever baseline is in Erply —
`saveInventoryRegistration` is a delta — so applying a container against a
fake 1000 compounds the error rather than correcting it. It also means the
live catalog currently tells buyers there are
1,000 units of more than half the range.

**How to apply:** if this ever is corrected, the fix belongs in Erply (stock
is authoritative there and `products.stock_qty` is excluded from the normal
sync — see [[project-receiving-phase-1]]), and it's a *set*, not a delta, so
`saveInventoryRegistration` is the wrong tool for it.
