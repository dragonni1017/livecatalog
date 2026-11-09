-- products.in_stock: true when stock_qty > 0 (generated, like 0054's
-- case_pieces / sold_by), so the storefront can list out-of-stock products
-- last in every sort. PostgREST can only order by a column, not by an
-- expression like (stock_qty > 0).
--
-- Never written by code: Postgres refuses writes to a generated column, so
-- no sync or upsert may include it (none does).
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project
-- aguorduaxfqrvvywgrdi) and run once, BEFORE merging the code that sorts by
-- it: without the column, every catalog listing query fails and the
-- storefront shows no products. Then load the public homepage and confirm
-- products show.

alter table public.products
  add column if not exists in_stock boolean
    generated always as (coalesce(stock_qty, 0) > 0) stored;
