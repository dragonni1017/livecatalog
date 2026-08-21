# Handoff: Live Inventory / Cycle-Count Reconciliation

**Status:** Planning only — no code written yet.

**For Claude Code:** read this fully before touching code. Update the "Progress Log" at the bottom as you work.

---

## Problem

`stock_qty` on `products` is currently a placeholder (999 for every row — see
`docs/memory/` note). The 7/8 paper tally of the "3D Printed" category is the
first real count going in. That count took hours across many pages, and the
warehouse doesn't stop shipping while it's being counted — so by the time
someone types the sheet into the system, the real shelf quantity has already
moved.

Reading the current code, the underlying issue is bigger than just "the count
is stale by entry time":

- **Nothing decrements `stock_qty` when an order is placed or fulfilled.**
  `POST /api/orders` (`app/api/orders/route.ts`) reads `stock_qty` only to
  flag an "out of stock" warning in the rep-notification email — it never
  writes it. So today, stock only ever moves via manual admin adjustment, an
  Excel/CSV re-import, or the Erply/Woo webhooks (if those are actually live —
  see open questions).
- **Several write paths overwrite `stock_qty` wholesale instead of applying a
  delta:** bulk "set" mode (`app/admin/api/stock/bulk/route.ts`), the Excel
  import path (`syncToSupabase()` in `lib/product-sync.ts`, used by both
  `/api/import` and the Erply cron `/api/sync`), and the Erply webhook's
  `amountInStock` branch. Any of these can silently stomp a change made by
  another path in between.
- **Two webhook handlers call a Postgres function that doesn't exist.**
  `app/api/webhooks/erply/route.ts` and `app/api/webhooks/woo/route.ts` both
  call `db.rpc('decrement_stock', ...)`, but no migration ever creates
  `decrement_stock()`. Those calls currently fail every time (swallowed by
  `Promise.allSettled`, only logged via `console.error`).
- **Bulk edits have no audit trail.** `/admin/api/stock` (single product)
  logs every change to `stock_adjustments` (migration `0004`). `/admin/api/stock/bulk`
  doesn't log anything — a bad bulk click is untraceable and unreversible.
- **Single/bulk adjust endpoints are read-then-write in JS**, not one atomic
  SQL statement — two concurrent writes to the same SKU (e.g. a staff
  adjustment landing at the same moment as a webhook) can race and lose an
  update.

## Goals

1. Get real counts into `stock_qty` without discarding units that moved
   out from under the count.
2. Make ongoing depletion show up in `stock_qty` continuously, not just at
   the next recount/import/sync.
3. Close the concurrency gaps above so two simultaneous writers can't
   clobber each other.
4. Every change, from every path, lands an audit row.

## Design

### 1. One atomic SQL primitive for every stock write

```sql
-- supabase/migrations/0018_adjust_stock_fn.sql
-- Atomic stock delta + audit row in a single statement. Replaces the JS
-- read-modify-write pattern in /admin/api/stock and gives the Erply/Woo
-- webhooks a real function to call instead of the never-created
-- `decrement_stock`.
-- HOW TO APPLY: paste into the Supabase SQL editor and run once.

create or replace function adjust_stock(
  p_sku              text,
  p_delta            integer,
  p_reason           text default null,
  p_changed_by_email text default 'system'
) returns table(product_id uuid, previous_qty integer, new_qty integer)
language plpgsql
security definer
as $$
declare
  v_id   uuid;
  v_name text;
  v_prev integer;
  v_new  integer;
begin
  select id, name, stock_qty into v_id, v_name, v_prev
  from products
  where sku = p_sku
  for update;                       -- row lock: serializes concurrent calls on the same SKU

  if v_id is null then
    raise exception 'No product with sku %', p_sku;
  end if;

  v_new := greatest(v_prev + p_delta, 0);
  update products set stock_qty = v_new, updated_at = now() where id = v_id;

  if p_delta <> 0 then
    insert into stock_adjustments
      (product_id, sku, product_name, delta, previous_qty, new_qty, reason, changed_by_email)
    values
      (v_id, p_sku, v_name, p_delta, v_prev, v_new, p_reason, p_changed_by_email);
  end if;

  return query select v_id, v_prev, v_new;
end;
$$;
```

`select ... for update` locks the row so a second concurrent call on the same
SKU blocks until the first commits — that's what removes the race window.
Route every write path (single adjust, bulk adjust, both webhooks, and the
count-reconciliation flow below) through this one function instead of
hand-rolled `.update()` calls. Bulk "set" mode becomes
`adjust_stock(sku, target_qty - current_qty)` under the hood, so a "set"
still produces a delta + audit row instead of a silent overwrite.

### 2. Treat a physical count as an anchored delta, not an overwrite

This is the actual fix for "the count keeps changing while we count."
Writing `stock_qty = counted_qty` is only correct if nothing else touched
that SKU between when you started counting it and when you type it in —
which won't hold for a multi-hour, multi-page tally like the 7/8 sheet.

Instead:

- Each count session gets one `started_at` timestamp (the sheet date, or
  finer-grained per page/photo if you want more accuracy — see open
  questions).
- On entry, for each counted SKU:
  `delta = counted_qty - stock_qty_as_of(started_at)`, then apply that
  delta via `adjust_stock()` to whatever `stock_qty` is *right now* — not an
  overwrite. Anything that already moved the number between `started_at`
  and now (a manual adjustment, a fulfilled order once step 3 below exists)
  is preserved; the count only contributes the change the recount itself
  discovered.
- `stock_qty_as_of(started_at)` = the `new_qty` from the most recent
  `stock_adjustments` row for that SKU before `started_at` (fall back to the
  current `stock_qty` if there's no earlier row).
- Build this as an admin screen or CSV import that reuses the existing
  `xlsx` pipeline (per `CLAUDE.md` — don't stand up a second one) with
  columns `SKU, Counted Qty` and one `Count Started At` field for the whole
  batch. Show a diff preview (counted vs. current vs. computed delta) before
  committing — same pattern `/api/import/diff` already uses for the regular
  Excel import.

### 3. Make orders actually deplete stock, at the moment stock leaves the building

Nothing does this today. Pick the moment that matches the real fulfillment
process — most likely when an admin marks an order "Converted" in
`/admin/orders`, since that's also roughly when it gets keyed into
QuickBooks Desktop — and call `adjust_stock(sku, -qty, 'order fulfilled: ORD-...')`
per line item at that moment, in the same transaction as the status change.
This is what makes "live" mean something day to day: recounts become a
periodic correction on top of a number that's already moving, instead of
being the only thing that ever moves it.

### 4. Fix or retire the Erply/Woo webhooks

Both currently call a function that doesn't exist and fail silently. Once
`adjust_stock()` exists, repoint them at it — or, if Erply/Woo aren't
actually wired up to this store today (the placeholder `999` everywhere
suggests they aren't), delete the dead code path instead of leaving a
webhook that 500s on every real call.

### 5. Give bulk edits the same audit trail as single edits

`/admin/api/stock/bulk` should call `adjust_stock()` per product (or a
batched variant of it) instead of raw `.update()`, so a bulk change is
traceable and reversible the same way a single adjustment already is.

## Open questions

- **Is Erply or Woo actually connected/live today**, or were those webhooks
  scaffolded for later? Determines fix-vs-delete for step 4.
- **What's the real fulfillment trigger?** Does marking an order
  "Converted" in `/admin/orders` correspond to "physically pulled and
  shipped," or is that decoupled from the actual warehouse pull? That's the
  moment step 3 needs to hook into.
- **Count granularity:** is one `started_at` per whole sheet/session good
  enough, or do you want per-page timestamps (you're already photographing
  pages in batches, like the 7/8 sheet) for tighter accuracy?
- **Entry UI:** extend the existing Excel import screen for counts, or build
  a separate "Cycle Count" screen? Reusing the Excel pipeline keeps to one
  import path per `CLAUDE.md`'s existing guidance.

## Suggested build order

1. `adjust_stock()` function — migration `0018_adjust_stock_fn.sql` (next
   free number after `0017_display_settings.sql`).
2. Repoint single-adjust and bulk-adjust endpoints, and the Erply/Woo
   webhooks (or delete them), to call it.
3. Cycle-count entry screen/import — delta-against-`started_at`, diff
   preview, then commit.
4. Order → stock decrement hook at the fulfillment/"Converted" status
   change.
5. Backfill the 3D Printed category counts through the new cycle-count flow
   once (1)–(3) exist, instead of a one-off manual import.

## Note on the photographed count sheet

I looked at all three pages closely enough to understand the counting
convention (SKU highlighted once counted; totals are hand-summed as
carton-count × units-per-carton, plus loose pieces, sometimes across
multiple locations for one SKU — e.g. `T641916` has three separate
sub-totals added together). I'm not transcribing it into a SKU→qty table
here: several entries have crossed-out numbers or ambiguous multiplication
chains, and a hand-transcribed number that's wrong is worse than no number,
especially feeding into a system with no reconciliation logic yet (that's
exactly the gap this doc fixes). Once step 2 above exists, that's the right
place to enter this sheet — it'll show you a diff instead of trusting a
blind read.

---

## Progress Log

*(append entries here as work happens — what was done, decisions made, anything left unfinished)*

- **2026-07-15:** Shipped a manual-only fix (Erply integration still on hold
  per user) covering build-order steps 1, 5, and part of 4:
  - `supabase/migrations/0018_adjust_stock_fn.sql` — `adjust_stock()`, applied
    live to project `aguorduaxfqrvvywgrdi`. One caveat vs. the draft above:
    `products.id` is `text`, not `uuid` (confirmed via `list_tables`) — the
    function and its return type use `text` throughout.
  - `/admin/api/stock` (single) and `/admin/api/stock/bulk` both now call
    `adjust_stock()` instead of hand-rolled read-then-write `.update()` calls.
    Bulk edits get the same `stock_adjustments` audit trail single edits
    already had, and both are now race-safe via the function's row lock.
  - Erply/Woo webhooks confirmed **not live** (user: "not able to implement
    erply yet"). Left the files in place but repointed their calls from the
    nonexistent `decrement_stock()` to `adjust_stock()`, so they no longer
    silently 500 if ever turned on — did not invest further since they're
    not in use.
  - **Not done, still open:** the cycle-count reconciliation screen (step 2)
    and the order→stock auto-decrement hook (step 3) — both depend on open
    questions above (fulfillment trigger, count granularity) that weren't
    settled this pass. Today, `stock_qty` still only moves via manual admin
    adjustment (single or bulk) or a full Excel/Erply re-import/sync.

- **2026-08-21:** Shipped step 3 (order → stock decrement hook). Dragon
  confirmed the fulfillment trigger question above: decrement at the
  "Converted" status change. `app/admin/api/orders/route.ts`'s PATCH
  handler now calls `adjust_stock()` per line item on that transition.
  Found and fixed a real double-decrement bug live during verification
  (comparing against the *previous* status let a converted → contacted →
  converted round trip decrement twice) — fixed with a dedicated
  `order_requests.stock_decremented_at` column (migration `0037`),
  decoupled from status the same way `entered_in_qb` already is. Verified
  live twice against a real SKU/disposable test order, both bugged and
  fixed behavior confirmed via direct queries. Full detail:
  [[project-order-fulfillment-stock-decrement]] in `docs/memory/`.
  **Not done, still open:** the cycle-count reconciliation screen (step 2)
  and `/admin/api/stock/bulk` still not routed through `adjust_stock()`
  (step 5) — neither touched this pass.
