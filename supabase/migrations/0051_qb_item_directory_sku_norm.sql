-- Case-insensitive SKU matching for qb_item_directory.
--
-- 0050 stored `sku` exactly as QuickBooks writes it, and QuickBooks' casing
-- does not match the supplier sheets': the same product is "P273813-45cm"
-- in QuickBooks and "P273813-45CM" once a caller upper-cases a staged SKU,
-- and a whole ribbon range is "FD400004-25yard" against "FD400004-25YARD".
-- Postgres `in` is case-sensitive, so 23 of 63 real matches were missed and
-- the admin screen reported 40 found instead of 63 -- which reads as "go
-- enter 27 products in QuickBooks" when only 4 are actually missing.
--
-- This is the third time this exact trap has bitten this project (the
-- staging route's catalog lookup, 2026-09-17; here, 2026-09-18), so it is
-- fixed declaratively rather than by remembering to upper-case at each call
-- site: a generated column cannot drift, and it backfills every existing row
-- on creation.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once. No migration runner in this project.

alter table qb_item_directory
  add column if not exists sku_norm text generated always as (upper(sku)) stored;

create index if not exists qb_item_directory_sku_norm_idx on qb_item_directory (sku_norm);
