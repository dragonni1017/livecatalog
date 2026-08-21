---
name: project-order-fulfillment-stock-decrement
description: 2026-08-21 -- stock_qty now decrements when an order is marked Converted (was previously never decremented by anything except manual edits/re-import); a real double-decrement bug was found and fixed live during verification
type: project
---

Per `docs/LIVE-INVENTORY-COUNT-HANDOFF.md`'s step 3 ("nothing decrements
`stock_qty` when an order is placed or fulfilled"), `app/admin/api/orders/
route.ts`'s PATCH handler now calls the existing `adjust_stock()` RPC
(migration 0018) per line item when an order's status transitions into
`converted` — Dragon confirmed that's the right trigger moment (roughly
when it also gets keyed into QuickBooks Desktop).

**Real bug found and fixed live, same session:** the first guard compared
against the order's *previous* status (`current.status !== 'converted'`).
That only blocks an exact repeated PATCH while status is already
`converted` — a `converted -> contacted -> converted` round trip (a real
admin workflow, e.g. re-contacting a customer after conversion) slipped
past it and decremented the same order's stock a second time. Caught via
live testing: SKU `3D801155` went `432 -> 429 -> 426` across that round
trip on a single test order, when it should have stayed at 429.

**Fixed** with `order_requests.stock_decremented_at` (migration `0037`),
decoupled from `status` entirely — same reasoning as `entered_in_qb`/
`entered_in_qb_at` (migration 0005): status can move back and forth, but
"did we already pull this order's stock" must stay a one-way fact. Set
atomically with the status write (before the `adjust_stock()` calls run),
so a partial per-item RPC failure can't leave the guard open for a retry
to double-count whichever items already succeeded.

**Verified live, twice** (once catching the bug, once confirming the fix)
using a real disposable test order against real SKU `3D801155` on
production — not a mock: watched `products.stock_qty` and
`stock_adjustments` directly through a `new -> converted -> contacted ->
converted` cycle. Stock corrected back to its real value by hand both
times (via a manual `stock_adjustments` row, since the correction itself
bypassed `adjust_stock()`), test order deleted after.

**Still open** (steps 2 and 5 of the handoff doc, not touched this pass):
- Cycle-count reconciliation screen (anchored-delta re-count, not a raw
  overwrite) — blocked on open questions in the handoff doc (count
  granularity, entry UI).
- `/admin/api/stock/bulk` still doesn't call `adjust_stock()` per the
  handoff doc's step 5 — wasn't verified/touched this session, don't
  assume it's fixed just because the order-fulfillment path now is.

**Why:** found while doing a general "what else needs improving" pass
across `docs/ROADMAP-OPEN.md`/memory — not reported as broken by anyone.
Two other candidates from that same pass (SMS notifications, the
low-stock-webhook item) turned out to be either genuinely blocked (needs
Twilio credentials) or built on a stale premise (the Erply/Woo webhooks
aren't actually live — see `docs/LIVE-INVENTORY-COUNT-HANDOFF.md`'s
"confirmed not live" note) and weren't pursued.

**How to apply:** if a future change needs to know whether an order's
stock was already pulled, check `stock_decremented_at`, never `status ===
'converted'` — the latter is exactly the bug this node documents. If
`/admin/api/stock/bulk` or the cycle-count screen get built later, route
them through `adjust_stock()` the same way this path and the single-edit
endpoint already do, per the handoff doc's "one atomic SQL primitive for
every stock write" design goal.
