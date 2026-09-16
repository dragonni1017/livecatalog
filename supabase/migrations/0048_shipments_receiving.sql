-- Receiving: stage a supplier packing list, correct the received counts, then
-- apply it once as an Erply stock registration. Phase 1 scope is written up in
-- docs/RECEIVING-PHASE-1-SCOPE.md.
--
-- Why staging exists at all rather than the screen calling Erply directly:
--  - A packing list records what the supplier SHIPPED. What arrived can differ
--    (short shipment, damage), so qty_received is editable before apply.
--  - Erply only has a delta API (saveInventoryRegistration), so applying the
--    same file twice would double the stock. file_hash is unique, and
--    applied_at is recorded per LINE, so a batch that fails halfway can be
--    resumed without re-adding what already landed. Same one-way-fact pattern
--    as order_requests.entered_in_qb (0005) and stock_decremented_at (0037).
--  - Stock is never written to products.stock_qty from here: it is excluded
--    from the Erply->Supabase sync on purpose (see 0042's anchored delta), so
--    a direct write would fight the order-fulfillment decrement and be
--    overwritten by the next sync anyway.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once. No migration runner in this project.

create table if not exists shipments (
  id            uuid primary key default gen_random_uuid(),
  file_name     text not null,
  -- Idempotency key: a re-upload of the same workbook opens the existing
  -- shipment instead of staging a second copy of the same container.
  file_hash     text not null unique,
  container_ref text,
  line_count    integer not null default 0,
  status        text not null default 'staged'
                  check (status in ('staged', 'applied', 'abandoned')),
  -- Free-text, e.g. "counted by warehouse 9/16, 2 cartons short".
  notes         text,
  staged_by     text,
  staged_at     timestamptz not null default now(),
  applied_by    text,
  applied_at    timestamptz
);

create table if not exists shipment_lines (
  id                uuid primary key default gen_random_uuid(),
  shipment_id       uuid not null references shipments(id) on delete cascade,
  sku               text not null,
  -- The sheet's own UPC value, kept verbatim even when it disagrees with
  -- products.barcode -- the disagreement is the finding worth keeping.
  barcode_from_file text,
  qty_shipped       integer not null,
  qty_received      integer not null,
  match_status      text not null
                      check (match_status in ('matched', 'unmatched_sku', 'barcode_mismatch')),
  -- Carton dimensions off the same sheet, already converted to INCHES and
  -- POUNDS by lib/packing-list.ts (headers name the source unit; see 0045 for
  -- the unit trap these columns exist to avoid). Stored but NOT written to
  -- products in Phase 1 -- scripts/import-packing-list.mjs already covers
  -- that and is safe on a file of any age.
  case_length_in    numeric(10,2),
  case_width_in     numeric(10,2),
  case_height_in    numeric(10,2),
  case_weight_lb    numeric(10,2),
  -- Populated by the apply step, per line, so a partial failure is resumable.
  erply_product_id  bigint,
  erply_stock_before integer,
  erply_stock_after  integer,
  applied_at        timestamptz,
  apply_error       text
);

create index if not exists idx_shipment_lines_shipment on shipment_lines(shipment_id);
create index if not exists idx_shipment_lines_sku      on shipment_lines(sku);
create index if not exists idx_shipments_status        on shipments(status);

alter table shipments      enable row level security;
alter table shipment_lines enable row level security;
-- No anon/authenticated policies: admin-only, all access through the
-- service-role client in app/admin/api/shipments/*.

-- Grants are required even for an admin-only table: PostgREST builds its
-- schema cache from what its roles can see, so a table with no grants returns
-- PGRST205 "Could not find the table 'public.shipments' in the schema cache"
-- on every query, which reads exactly like this migration never ran.
--
-- Looped over pg_roles rather than granting to a fixed list, because this
-- project has no `service_role` role (it uses the newer publishable/secret
-- API keys). A plain `grant ... to anon, authenticated, service_role` is
-- all-or-nothing: the missing role errors the whole statement, and since the
-- Supabase SQL editor runs a script in ONE transaction, that error would roll
-- back the create table statements above and leave nothing behind.
do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role', 'postgres', 'authenticator']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('grant all privileges on table shipments to %I', role_name);
      execute format('grant all privileges on table shipment_lines to %I', role_name);
    end if;
  end loop;
end $$;

-- Granting to anon/authenticated is not a leak: RLS is on with no policies,
-- so neither role can read a row. The grant only makes the tables visible to
-- PostgREST's schema cache; the policies still decide who reads what.
notify pgrst, 'reload schema';

comment on table shipments is
  'One staged supplier packing list. Applying it registers stock in Erply (never in products.stock_qty) exactly once -- see docs/RECEIVING-PHASE-1-SCOPE.md.';
comment on table shipment_lines is
  'Per-SKU lines of a staged shipment. qty_shipped is what the sheet claimed; qty_received is what the warehouse confirmed and is what gets registered.';
