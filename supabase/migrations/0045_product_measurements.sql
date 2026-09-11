-- 0045_product_measurements.sql
--
-- Physical measurements for products, so warehouse bin capacity can be
-- computed ("how many cases of this SKU fit in bin 01-03-2, by volume and by
-- weight limit"). Nothing in this repo held a weight or a dimension before
-- this migration.
--
-- UNITS ARE IN THE COLUMN NAMES ON PURPOSE. The upstream data is inches and
-- pounds -- Erply's own configured unit list is `pcs, lb, in, ft, sq ft, cu
-- ft`, and the numbers only make physical sense read that way (an 18" plush
-- 6-pack is 23.6 x 18 x 20 at 33.5; as cm+kg that is 33.5 kg in an 8.5-litre
-- box, three times the density of concrete). WooCommerce's store settings
-- *declare* kg/cm and are simply mislabelling the same values, confirmed
-- 2026-09-11: of 3,160 fields where Erply and Woo both had data, zero
-- differed by more than 2%. A bare `weight` column would have silently
-- invited that 2.2x error back in.
--
-- Case and unit are tracked separately because they are different numbers
-- and only one of them exists upstream. Every measured product in Erply is
-- named "N/pk" and the figures are master-carton values (a "3D Printed
-- Turtle Keychain - 12/pk 5bx/cs" at 29 lb is a case, not twelve
-- keychains), so the Erply backfill populates the case_* columns only.
-- unit_* is for hand-entered per-piece figures and starts empty.
--
-- Erply cannot hold the unit-level set: it has exactly one dimension triple
-- plus netWeight per product, and its native packaging fields
-- (productPackages, containerID, soldInPackages) are unused on all 3,076
-- active products. So this table is the system of record for measurements,
-- not a cache of Erply's.
--
-- No RLS policy is added here, deliberately. These are new columns on the
-- existing `products` table, which already has its public SELECT policy, so
-- the CLAUDE.md "new table needs an explicit public SELECT policy" rule does
-- not apply. Measurements are admin-only anyway -- public catalog queries
-- select named columns and will not pick these up.

alter table products
  -- Master carton / case. Backfilled from Erply (length, width, height,
  -- netWeight); 2,198 of 3,222 active products can be filled this way.
  add column if not exists case_length_in  numeric(8,2),
  add column if not exists case_width_in   numeric(8,2),
  add column if not exists case_height_in  numeric(8,2),
  add column if not exists case_weight_lb  numeric(8,2),

  -- Individual sellable piece. No upstream source -- hand-entered.
  add column if not exists unit_length_in  numeric(8,2),
  add column if not exists unit_width_in   numeric(8,2),
  add column if not exists unit_height_in  numeric(8,2),
  add column if not exists unit_weight_lb  numeric(8,2),

  -- Provenance. Without this a re-run of the Erply backfill would overwrite
  -- a warehouse hand-measurement with the stale upstream number, which is
  -- the whole reason hand-entry exists.
  add column if not exists measurements_source     text,
  add column if not exists measurements_updated_at timestamptz,
  add column if not exists measurements_updated_by text;

-- A measurement is either absent (null) or a real positive number. Zero is
-- how both Erply and WooCommerce spell "never filled in", and letting a 0
-- through would read as a measured product with no volume -- which a
-- capacity calculation would happily divide by.
-- Written out rather than looped in a DO block: this file is pasted into the
-- Supabase SQL editor by hand, so it should be readable top to bottom.
-- drop-then-add on every constraint keeps the whole migration re-runnable.
alter table products drop constraint if exists products_case_length_in_positive;
alter table products drop constraint if exists products_case_width_in_positive;
alter table products drop constraint if exists products_case_height_in_positive;
alter table products drop constraint if exists products_case_weight_lb_positive;
alter table products drop constraint if exists products_unit_length_in_positive;
alter table products drop constraint if exists products_unit_width_in_positive;
alter table products drop constraint if exists products_unit_height_in_positive;
alter table products drop constraint if exists products_unit_weight_lb_positive;
alter table products drop constraint if exists products_measurements_source_valid;

alter table products
  add constraint products_case_length_in_positive check (case_length_in is null or case_length_in > 0),
  add constraint products_case_width_in_positive  check (case_width_in  is null or case_width_in  > 0),
  add constraint products_case_height_in_positive check (case_height_in is null or case_height_in > 0),
  add constraint products_case_weight_lb_positive check (case_weight_lb is null or case_weight_lb > 0),
  add constraint products_unit_length_in_positive check (unit_length_in is null or unit_length_in > 0),
  add constraint products_unit_width_in_positive  check (unit_width_in  is null or unit_width_in  > 0),
  add constraint products_unit_height_in_positive check (unit_height_in is null or unit_height_in > 0),
  add constraint products_unit_weight_lb_positive check (unit_weight_lb is null or unit_weight_lb > 0),
  add constraint products_measurements_source_valid
    check (measurements_source is null or measurements_source in ('erply', 'woo', 'manual'));

-- Drives the "what still needs measuring" worklist: 1,024 active products
-- have no case measurements in Erply or WooCommerce and need physical
-- measurement. Partial index because that set shrinks toward empty as the
-- backfill and hand-entry proceed, and it's the only query that scans for
-- nulls here.
create index if not exists idx_products_case_measurements_missing
  on products (sku)
  where case_weight_lb is null or case_length_in is null
     or case_width_in is null or case_height_in is null;

comment on column products.case_weight_lb is
  'Master carton weight in POUNDS. Source data is imperial despite WooCommerce declaring kg -- see migration 0045.';
comment on column products.case_length_in is
  'Master carton dimensions in INCHES. See migration 0045 before converting anything.';
