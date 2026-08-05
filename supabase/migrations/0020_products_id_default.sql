-- The `products` table predates this migrations folder (created directly in
-- the Supabase SQL editor) and has `id` as `text primary key` with NO
-- default -- someone hand-assigned the original 'prod-NNNNN' ids on a
-- one-time import. lib/product-sync.ts's syncToSupabase() never supplies
-- `id` on upsert, assuming Postgres would generate one. Postgres checks
-- NOT NULL constraints while building the candidate row *before*
-- ON CONFLICT DO UPDATE applies, so every upsert -- inserts of new SKUs
-- AND updates to existing ones -- has been failing with
-- "null value in column id violates not-null constraint" (confirmed live
-- 2026-08-05). This is why the catalog was frozen on stale data despite
-- the Erply cron running daily: no sync has actually written anything
-- since whatever one-time script originally seeded the table.
--
-- Fix: give id a real default, continuing the existing 'prod-NNNNN'
-- (5-digit, zero-padded) convention already used by ~3,021 rows. This
-- requires no application code change -- the app never sets `id` in its
-- upsert payload, so on the update path the default-generated value is
-- only used to satisfy the NOT NULL check on the candidate row and is
-- never written back (Supabase's upsert only updates columns present in
-- the payload).

create sequence if not exists products_id_seq;

select setval(
  'products_id_seq',
  coalesce((select max(substring(id from 6)::integer) from products where id ~ '^prod-[0-9]+$'), 0),
  true
);

alter table products
  alter column id set default ('prod-' || lpad(nextval('products_id_seq')::text, 5, '0'));
