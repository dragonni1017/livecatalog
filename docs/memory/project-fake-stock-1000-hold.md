---
name: project-fake-stock-1000-hold
description: 2026-09-16 — 1,879 products still read stock_qty exactly 1000 (August's fake connectivity-test value); Dragon's call is to leave it alone for now
type: project
---

Counted live 2026-09-16: **1,879 of 3,225 products have `stock_qty` of exactly
1000**. 994 have a real-looking non-zero quantity and 352 are at zero. That
matches the ~2,074 SKUs deliberately set to a fake stock of 1000 in Erply as a
connectivity test on 2026-08-17 (see [[project-erply-pagination-fix]]), whose
revert path was written but never run.

**DECIDED by Dragon 2026-09-16: do not adjust it yet.** Not an oversight and
not a task to pick up unprompted.

**Why it still matters:** receiving *adds* to whatever baseline is in Erply —
`saveInventoryRegistration` is a delta — so applying a container against a
fake 1000 compounds the error rather than correcting it. Worth confirming
against Erply before the first real apply of a container that includes any of
those SKUs. It also means the live catalog currently tells buyers there are
1,000 units of more than half the range.

**How to apply:** if this ever is corrected, the fix belongs in Erply (stock
is authoritative there and `products.stock_qty` is excluded from the normal
sync — see [[project-receiving-phase-1]]), and it's a *set*, not a delta, so
`saveInventoryRegistration` is the wrong tool for it.
