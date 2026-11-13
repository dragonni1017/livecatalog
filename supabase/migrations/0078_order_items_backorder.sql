-- Backorders on quote requests (lib/order-submission.ts).
--
-- Buyers can now request more than is in stock, including sold-out items.
-- backorder_qty is how much of the line was over stock when the order was
-- placed (qty - stock, floored at 0): a snapshot, since stock moves on.
-- Written by /api/orders right after submit_order() (whose signature is
-- unchanged), shown as a Backorder badge on the admin order page.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project
-- aguorduaxfqrvvywgrdi) and run once. Then confirm:
--   select count(*) from order_items where backorder_qty = 0;
-- (equals the total row count). Until it runs, orders still go through;
-- the backorder amount just isn't saved (logged), and the rep email still
-- lists the backordered lines.
--
-- Existing table: its grants and RLS already cover a new column.

alter table order_items
  add column if not exists backorder_qty integer not null default 0
    check (backorder_qty >= 0);
