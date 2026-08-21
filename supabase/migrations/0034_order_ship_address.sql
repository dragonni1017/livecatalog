-- Add a ship-to address to order_requests and thread it through submit_order().
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once. No migration runner in this project.
--
-- Dragon: address wasn't captured anywhere in the order model, so QuickBooks
-- Sales Orders had no Ship To info at all. Adds ship_address1/2/city/state/
-- zip/country columns and threads them through submit_order() the same way
-- 0030 threaded rep/tier attribution -- all optional (default null / 'US')
-- so no existing caller breaks.
--
-- IMPORTANT: changing a function's parameter list creates a NEW overload in
-- Postgres rather than replacing the old one -- drop the old 13-arg
-- signature explicitly first, then re-run the lock-down from
-- 0025_lock_down_definer_functions.sql against the new 19-arg signature.

alter table order_requests
  add column ship_address1 text,
  add column ship_address2 text,
  add column ship_city     text,
  add column ship_state    text,
  add column ship_zip      text,
  add column ship_country  text default 'US';

drop function if exists submit_order(text, text, text, text, text, text, integer, text, text, jsonb, uuid, text, numeric);

create or replace function submit_order(
  p_reference_code               text,
  p_customer_name                text,
  p_customer_email               text,
  p_customer_phone               text,
  p_customer_company             text,
  p_notes                        text,
  p_subtotal_cents               integer,
  p_placed_by_rep                text,
  p_po_number                    text,
  p_items                        jsonb,   -- [{product_id,sku,name,unit_price_cents,qty,line_total_cents}]
  p_rep_user_id                   uuid default null,
  p_applied_tier_code             text default null,
  p_applied_tier_discount_percent numeric default null,
  p_ship_address1                 text default null,
  p_ship_address2                 text default null,
  p_ship_city                     text default null,
  p_ship_state                    text default null,
  p_ship_zip                      text default null,
  p_ship_country                  text default 'US'
) returns text               -- returns the new order UUID
language plpgsql
security definer
as $$
declare
  v_id uuid;
begin
  insert into order_requests (
    reference_code, status,
    customer_name, customer_email, customer_phone, customer_company,
    notes, subtotal_cents, placed_by_rep, po_number,
    rep_user_id, applied_tier_code, applied_tier_discount_percent,
    ship_address1, ship_address2, ship_city, ship_state, ship_zip, ship_country
  ) values (
    p_reference_code, 'new',
    p_customer_name, p_customer_email, p_customer_phone, p_customer_company,
    p_notes, p_subtotal_cents, p_placed_by_rep, p_po_number,
    p_rep_user_id, p_applied_tier_code, p_applied_tier_discount_percent,
    p_ship_address1, p_ship_address2, p_ship_city, p_ship_state, p_ship_zip, p_ship_country
  )
  returning id into v_id;

  insert into order_items (order_id, product_id, sku, name, unit_price_cents, qty, line_total_cents)
  select
    v_id,
    (item->>'product_id'),
    (item->>'sku'),
    (item->>'name'),
    (item->>'unit_price_cents')::integer,
    (item->>'qty')::integer,
    (item->>'line_total_cents')::integer
  from jsonb_array_elements(p_items) as item;

  return v_id::text;
end;
$$;

revoke execute on function public.submit_order(text, text, text, text, text, text, integer, text, text, jsonb, uuid, text, numeric, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.submit_order(text, text, text, text, text, text, integer, text, text, jsonb, uuid, text, numeric, text, text, text, text, text, text) to service_role;
alter function public.submit_order(text, text, text, text, text, text, integer, text, text, jsonb, uuid, text, numeric, text, text, text, text, text, text) set search_path = public, pg_temp;
