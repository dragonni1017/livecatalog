-- Reseed products_id_seq past every id that actually exists.
--
-- Migration 0020 gave products.id a default of
--   'prod-' || lpad(nextval('products_id_seq')::text, 5, '0')
-- and seeded the sequence from the highest prod-NNNNN in the table at that
-- moment. Two things then pulled the sequence and the table apart:
--
--  1. The default is evaluated for EVERY candidate row of an upsert, not just
--     the ones that insert, so each full Erply sync burns ~3,200 values. The
--     sequence climbs fast and independently of what is stored.
--  2. Scripts that insert products directly (scripts/push-new-plush-to-
--     supabase.mjs and the 2026-09-01 batch of 194 rows, ids prod-40493 to
--     prod-40686) assign ids as max+1 without touching the sequence.
--
-- So the sequence eventually climbs into a band of ids that already exist,
-- and every insert fails with
--   duplicate key value violates unique constraint "products_pkey"
-- Observed live 2026-09-23: a sync of 3,152 products inserted 0 of the 74
-- SKUs received that day and lost 652 rows' updates with them, because
-- Supabase upserts in chunks and one bad row fails the whole chunk. The
-- failure is loud in the response's errors[] but invisible on the site --
-- it just looks like the new products never arrived.
--
-- Re-run this whenever a script hand-assigns a block of prod-NNNNN ids.
-- It is idempotent and safe to run at any time.

select setval(
  'products_id_seq',
  coalesce((select max(substring(id from 6)::integer) from products where id ~ '^prod-[0-9]+$'), 0),
  true
);

-- Verification (expect: next_id greater than max_existing):
--   select
--     (select max(substring(id from 6)::integer) from products where id ~ '^prod-[0-9]+$') as max_existing,
--     nextval('products_id_seq') as next_id;
