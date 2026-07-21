-- Atomic stock delta + audit row, callable from any write path (manual admin
-- adjust, bulk adjust, and — if ever re-enabled — the Erply/Woo webhooks)
-- instead of separate read-then-write JS plus a manual stock_adjustments
-- insert. `select ... for update` row-locks the product so two concurrent
-- calls on the same SKU serialize instead of racing and losing an update.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once. No migration runner in this project.
--
-- NOTE: products.id is `text`, not uuid (confirmed via `list_tables`) —
-- this differs from the uuid draft in docs/LIVE-INVENTORY-COUNT-HANDOFF.md.
--
-- Implements step 1 ("one atomic SQL primitive for every stock write") and
-- step 5 ("give bulk edits the same audit trail as single edits") of the
-- build order in docs/LIVE-INVENTORY-COUNT-HANDOFF.md. The cycle-count
-- reconciliation screen and the order-fulfillment auto-decrement hook
-- described in that doc are intentionally NOT part of this pass — this is
-- the manual-adjustment-only fix while real Erply integration is on hold.

create or replace function adjust_stock(
  p_sku              text,
  p_delta            integer,
  p_reason           text default null,
  p_changed_by_email text default 'admin'
) returns table(product_id text, previous_qty integer, new_qty integer)
language plpgsql
security definer
as $$
declare
  v_id   text;
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
