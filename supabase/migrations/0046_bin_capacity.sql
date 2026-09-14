-- 0046_bin_capacity.sql
--
-- Warehouse bin dimensions and weight limits, so bin capacity can be
-- computed against the carton measurements added in 0045 ("how many cases of
-- this SKU fit in bin 01-03-2, by volume and by weight").
--
-- WHY THIS LIVES HERE AND NOT IN ERPLY: Erply has the bins -- 518 of them,
-- confirmed live 2026-09-11 and again 2026-09-14 via getBins -- but its bin
-- record exposes only binID, warehouseID, code, status, preferred, order,
-- allowedProduct, replenishmentMinimum and maximumAmount. There is no
-- dimension field and no weight-limit field of any kind, and maximumAmount
-- (a bare quantity) is 0 on all 518. getLocations, getWarehouseLocations,
-- getStorageLocations and getProductsInBins all return error 1005
-- (unsupported) on this account. So the sizes have nowhere to go upstream.
--
-- UNITS ARE INCHES AND POUNDS, matching 0045's case_*_in / case_weight_lb
-- columns. A capacity calculation divides one by the other, so a mismatch
-- here would be silent and wrong -- the unit is in every column name for
-- that reason.
--
-- Dimensions live on bin_types, not on bins. The 516 real bins are
-- aisle-rack-level codes (01-01-1 … ) and physically come in a handful of
-- shapes, so measuring each of 518 separately would be busywork and would
-- drift. A bin with no type has unknown capacity and is simply excluded from
-- capacity maths; if one bin is genuinely odd, give it its own type. There is
-- deliberately no per-bin dimension override -- one place to look, no
-- precedence rule to get wrong.
--
-- RLS: both tables are enabled with NO policies, on purpose. These are
-- admin-only and every read/write goes through the service-role client
-- (lib/supabase getAdminClient), which bypasses RLS. The CLAUDE.md rule about
-- needing an explicit public SELECT policy applies to tables the *public
-- catalog* reads with the anon key; nothing public touches these, and adding
-- a public policy would expose warehouse layout for no reason.

create table if not exists bin_types (
  id             uuid primary key default gen_random_uuid(),
  name           text not null unique,
  -- Usable interior, not the outside of the rack: what actually fits.
  length_in      numeric(8,2),
  width_in       numeric(8,2),
  height_in      numeric(8,2),
  -- Safe working load for one bin. Nullable because a shelf's rating is
  -- often only known from the rack's data plate, which may not be to hand.
  max_weight_lb  numeric(8,2),
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists bins (
  id                 uuid primary key default gen_random_uuid(),
  -- Erply's bin code, e.g. '01-01-1'. The join key a human uses and what a
  -- pick list shows, so it's the natural unique key here.
  code               text not null unique,
  -- Erply's own identifiers, kept so a later push of computed capacity into
  -- Erply's maximumAmount (the one capacity field it has) doesn't need to
  -- re-resolve bins by code.
  erply_bin_id       integer unique,
  erply_warehouse_id integer,
  bin_type_id        uuid references bin_types(id) on delete set null,
  -- Mirrored from Erply so an archived bin can be excluded without a live
  -- API call. Erply uses 'ACTIVE' / 'ARCHIVED'.
  status             text not null default 'ACTIVE',
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_bins_bin_type_id on bins(bin_type_id);
-- Drives "which bins still have no capacity recorded", the worklist query.
create index if not exists idx_bins_untyped on bins(code) where bin_type_id is null;

-- A dimension or a weight limit is either unknown (null) or a real positive
-- number. Zero would read as a real bin with no capacity, which a division
-- would then treat as "nothing fits" rather than "not measured yet" -- the
-- same trap 0045 guards against on the product side.
alter table bin_types drop constraint if exists bin_types_length_in_positive;
alter table bin_types drop constraint if exists bin_types_width_in_positive;
alter table bin_types drop constraint if exists bin_types_height_in_positive;
alter table bin_types drop constraint if exists bin_types_max_weight_lb_positive;
alter table bins      drop constraint if exists bins_status_valid;

alter table bin_types
  add constraint bin_types_length_in_positive     check (length_in     is null or length_in     > 0),
  add constraint bin_types_width_in_positive      check (width_in      is null or width_in      > 0),
  add constraint bin_types_height_in_positive     check (height_in     is null or height_in     > 0),
  add constraint bin_types_max_weight_lb_positive check (max_weight_lb is null or max_weight_lb > 0);

alter table bins
  add constraint bins_status_valid check (status in ('ACTIVE', 'ARCHIVED'));

alter table bin_types enable row level security;
alter table bins      enable row level security;

-- REQUIRED, and the thing that is easy to miss. PostgREST builds its schema
-- cache from what its roles can actually see, so a table with no grants is
-- invisible to the API even though it exists in `public` and the cache is
-- fresh -- every query returns PGRST205 "Could not find the table
-- 'public.bins' in the schema cache", which reads exactly like the migration
-- never ran. Confirmed live 2026-09-14: both tables were created here with
-- zero grants, so this project does not hand new tables their privileges.
--
-- Looped over pg_roles rather than granting to a fixed list, because
-- **this project has no `service_role` role** (it uses the newer
-- publishable/secret API keys). A plain
-- `grant ... to anon, authenticated, service_role` is all-or-nothing: the
-- missing role makes the whole statement error, nothing is granted, and
-- since the Supabase SQL editor runs a script in ONE transaction, the error
-- would also roll back the create table statements above. That is how a
-- migration "applies successfully" and leaves nothing behind.
do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role', 'postgres', 'authenticator']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('grant all privileges on table bin_types to %I', role_name);
      execute format('grant all privileges on table bins to %I', role_name);
    end if;
  end loop;
end $$;

-- Granting to anon/authenticated is not a data leak here: RLS is enabled
-- above with no policies, so neither role can read a single row. The grant
-- only makes the table visible to PostgREST's schema cache; the policies
-- still decide who reads what.
notify pgrst, 'reload schema';

comment on table bins is
  'Warehouse bins mirrored from Erply getBins. Erply holds the bins but has no dimension or weight-limit field, so capacity is recorded here — see migration 0046.';
comment on table bin_types is
  'Reusable bin shape: usable interior in INCHES and safe working load in POUNDS, matching products.case_*_in / case_weight_lb from migration 0045.';
