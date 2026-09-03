-- Lets the Erply -> catalog stock sync compute a delta against what
-- stock_qty WAS as of the previous sync run, instead of blindly overwriting
-- it -- so an order-fulfillment decrement (app/admin/api/orders/route.ts,
-- migration 0037) or a manual admin stock edit made in Supabase between
-- sync runs survives the next Erply sync instead of being clobbered by it.
-- Same "anchored delta" design already written up for manual paper counts
-- in docs/LIVE-INVENTORY-COUNT-HANDOFF.md, generalized here to an automated
-- periodic source instead of a one-off count. See lib/product-sync.ts's
-- syncStockFromErply() for the function that actually uses this.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once. No migration runner in this project.

-- Single-row table (id is always `true`) tracking when the stock sync last
-- ran, so the next run knows what timestamp to anchor its deltas against.
create table if not exists erply_sync_state (
  id                 boolean primary key default true check (id),
  last_stock_sync_at timestamptz
);
insert into erply_sync_state (id) values (true) on conflict (id) do nothing;

alter table erply_sync_state enable row level security;
-- No anon/authenticated policies -- only the service-role sync route
-- (app/api/sync/route.ts) touches this table.

-- stock_adjustments already has idx_stock_adjustments_created_at, but not
-- one usable for "most recent row for this SKU at or before a timestamp" --
-- add the (sku, created_at desc) index the lookup below actually needs.
create index if not exists idx_stock_adjustments_sku_created_at
  on stock_adjustments(sku, created_at desc);

-- For each requested SKU, returns stock_qty as it stood at p_as_of: the
-- new_qty of the most recent stock_adjustments row at or before that time,
-- falling back to the product's current stock_qty when there's no earlier
-- adjustment row for that SKU (nothing has moved it since it was created/
-- last imported) -- same fallback docs/LIVE-INVENTORY-COUNT-HANDOFF.md
-- already accepts for the equivalent paper-count case.
create or replace function stock_qty_as_of_bulk(p_skus text[], p_as_of timestamptz)
returns table(sku text, qty integer)
language sql
stable
as $$
  select
    p.sku,
    coalesce(
      (
        select sa.new_qty
        from stock_adjustments sa
        where sa.sku = p.sku and sa.created_at <= p_as_of
        order by sa.created_at desc
        limit 1
      ),
      p.stock_qty
    ) as qty
  from products p
  where p.sku = any(p_skus)
$$;
