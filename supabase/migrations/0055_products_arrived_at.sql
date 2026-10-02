-- 0055: products.arrived_at, when stock of this SKU last physically arrived
-- (2026-10-02).
--
-- The catalog's "Newest" sort ordered by created_at, which is the IMPORT
-- date: when a row reached Supabase through a bulk import or sync, not when
-- stock arrived. The real date is when /admin/receiving applies a shipment
-- (shipments.applied_at). Those tables are service-role only, and the
-- catalog sorts and pages in SQL through the public client, so the date has
-- to live on products.
--
-- Kept right by triggers, with no app change needed:
--   * a shipment's status changes -> recompute arrived_at for its SKUs. The
--     apply route sets 'applied' BEFORE calling Erply and flips back to
--     'staged' on rejection, so this must RECOMPUTE, not just stamp.
--   * a product is inserted -> pick up arrived_at from any applied shipment it
--     was on. New SKUs often reach the catalog after their container was
--     applied (the 75 of 2026-09-23).
-- The Erply sync's bulk upserts never carry arrived_at, so the key-union NULL
-- trap (CLAUDE.md) doesn't touch it.
--
-- Run as SEPARATE small statements in the SQL editor. Large pastes have been
-- losing text (0053, 0054).

-- 1. The column.
alter table public.products add column if not exists arrived_at timestamptz;

-- 2. Latest applied arrival for one SKU (null if none).
create or replace function public.latest_arrival_for_sku(p_sku text)
returns timestamptz language sql stable as $$
  select max(s.applied_at)
  from public.shipment_lines l
  join public.shipments s on s.id = l.shipment_id
  where l.sku = p_sku and s.status = 'applied' and l.qty_received > 0
$$;

-- 3. Shipment status change -> recompute its SKUs.
create or replace function public.shipments_recompute_arrived_at()
returns trigger language plpgsql as $$
begin
  update public.products p
     set arrived_at = public.latest_arrival_for_sku(p.sku)
   where p.sku in (select l.sku from public.shipment_lines l where l.shipment_id = new.id);
  return null;
end
$$;

-- 4. Attach it.
drop trigger if exists trg_shipments_arrived_at on public.shipments;
create trigger trg_shipments_arrived_at
  after update of status, applied_at on public.shipments
  for each row
  when (old.status is distinct from new.status or old.applied_at is distinct from new.applied_at)
  execute function public.shipments_recompute_arrived_at();

-- 5. New product -> inherit any recorded arrival.
create or replace function public.products_set_arrived_at()
returns trigger language plpgsql as $$
begin
  if new.arrived_at is null then
    new.arrived_at := public.latest_arrival_for_sku(new.sku);
  end if;
  return new;
end
$$;

-- 6. Attach it.
drop trigger if exists trg_products_arrived_at on public.products;
create trigger trg_products_arrived_at
  before insert on public.products
  for each row execute function public.products_set_arrived_at();

-- 7. Backfill existing products, then index and reload.
update public.products p
   set arrived_at = public.latest_arrival_for_sku(p.sku)
 where p.arrived_at is distinct from public.latest_arrival_for_sku(p.sku);
create index if not exists idx_products_arrived_at on public.products(arrived_at desc nulls last);
notify pgrst, 'reload schema';
