-- Extend submit_order() with rep/tier attribution params.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once. No migration runner in this project.
--
-- Adds p_rep_user_id / p_applied_tier_code / p_applied_tier_discount_percent,
-- all optional (default null) so the existing public-facing call in
-- app/api/orders/route.ts keeps working unchanged.
--
-- IMPORTANT: changing a function's parameter list creates a NEW overload in
-- Postgres rather than replacing the old one -- `create or replace` alone
-- would leave the original 10-arg submit_order() callable too. Drop the old
-- signature explicitly first, then re-run the lock-down from
-- 0025_lock_down_definer_functions.sql against the new signature, or the new
-- overload is left with Postgres/Supabase's default public-callable grant,
-- reopening the exact hole 0025 closed.

drop function if exists submit_order(text, text, text, text, text, text, integer, text, text, jsonb);

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
  p_applied_tier_discount_percent numeric default null
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
    rep_user_id, applied_tier_code, applied_tier_discount_percent
  ) values (
    p_reference_code, 'new',
    p_customer_name, p_customer_email, p_customer_phone, p_customer_company,
    p_notes, p_subtotal_cents, p_placed_by_rep, p_po_number,
    p_rep_user_id, p_applied_tier_code, p_applied_tier_discount_percent
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

revoke execute on function public.submit_order(text, text, text, text, text, text, integer, text, text, jsonb, uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.submit_order(text, text, text, text, text, text, integer, text, text, jsonb, uuid, text, numeric) to service_role;
alter function public.submit_order(text, text, text, text, text, text, integer, text, text, jsonb, uuid, text, numeric) set search_path = public, pg_temp;
