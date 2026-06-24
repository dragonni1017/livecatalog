-- Manual stock adjustments + staff login — see STAFF-LOGIN-AND-STOCK-ADJUSTMENTS-HANDOFF.md
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once. No migration runner in this project.
--
-- One row per manual stock change made from /admin/products (the "Adjust Stock"
-- button). delta is the signed change (+10 received, -2 damaged/sold); previous_qty
-- and new_qty are snapshotted so the row is self-contained even if products.stock_qty
-- changes again later. sku/product_name are snapshotted too so history survives a
-- product deletion (product_id is SET NULL rather than cascading the row away).
--
-- Attribution: changed_by_user_id references the Supabase Auth user who made the
-- change (see auth.users — staff accounts are created via the Supabase Dashboard,
-- there is no public sign-up). changed_by_email is snapshotted alongside it so
-- history still shows who made a change even if the account is later removed.

create extension if not exists pgcrypto;

create table if not exists stock_adjustments (
  id                 uuid primary key default gen_random_uuid(),
  product_id         text references products(id) on delete set null,
  sku                text not null,
  product_name       text not null,
  delta              integer not null check (delta <> 0),
  previous_qty       integer not null check (previous_qty >= 0),
  new_qty            integer not null check (new_qty >= 0),
  reason             text,
  changed_by_user_id uuid references auth.users(id) on delete set null,
  changed_by_email   text not null,
  created_at         timestamptz not null default now()
);

create index if not exists idx_stock_adjustments_product_id  on stock_adjustments(product_id);
create index if not exists idx_stock_adjustments_created_at  on stock_adjustments(created_at desc);

-- RLS on, no anon/authenticated policies: reads/writes happen only through the
-- service-role client in /admin/api/stock, which separately checks for a valid
-- Supabase Auth session before doing anything (service role bypasses RLS).
alter table stock_adjustments enable row level security;
