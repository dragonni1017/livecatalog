-- Atomic order submission — Django atomic() equivalent.
-- Wraps order_requests + order_items inserts in one transaction so a
-- partial failure never leaves an orphaned order with no items.
-- Replaces the manual delete-on-error pattern in /api/orders.
-- HOW TO APPLY: paste into the Supabase SQL editor and run once.

create or replace function submit_order(
  p_reference_code   text,
  p_customer_name    text,
  p_customer_email   text,
  p_customer_phone   text,
  p_customer_company text,
  p_notes            text,
  p_subtotal_cents   integer,
  p_placed_by_rep    text,
  p_po_number        text,
  p_items            jsonb   -- [{product_id,sku,name,unit_price_cents,qty,line_total_cents}]
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
    notes, subtotal_cents, placed_by_rep, po_number
  ) values (
    p_reference_code, 'new',
    p_customer_name, p_customer_email, p_customer_phone, p_customer_company,
    p_notes, p_subtotal_cents, p_placed_by_rep, p_po_number
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
