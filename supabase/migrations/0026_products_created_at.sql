-- The catalog's "Newest" sort (app/(catalog)/page.tsx) has been querying
-- products.created_at, which never existed on this table -- every request
-- with ?sort=newest silently 500s (Postgres error 42703). products.updated_at
-- exists but is not a usable substitute: it gets touched by every bulk
-- sync/backfill script, not just genuine new-product inserts (spot-checked
-- live -- only 3 distinct updated_at values across a 2000-row sample).
--
-- No real historical creation timestamp exists anywhere for the ~3,000
-- existing products (no CREATE TABLE migration for products, no populated
-- import_runs rows) -- backfilling them to today is the honest option;
-- "Newest" becomes meaningful going forward as products are actually added.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at DESC);
