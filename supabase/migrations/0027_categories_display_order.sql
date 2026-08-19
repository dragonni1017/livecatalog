-- categories.display_order is referenced by lib/types.ts's Category interface
-- and queried directly (app/(catalog)/new-arrivals/page.tsx,
-- app/admin/price-list/page.tsx: .order('display_order'); app/(catalog)/page.tsx's
-- Best Sellers select: category:categories(..., display_order)) but never
-- existed as a real column -- every one of those queries has been failing
-- with Postgres error 42703 the whole time. TypeScript never caught it
-- because Supabase client calls aren't checked against the live schema.
--
-- Confirmed live 2026-08-19: this breaks the New Arrivals page entirely (its
-- own categories query 42703s, collapsing the sidebar to just "New Arrivals"
-- / "All Products" instead of the full category list) and silently empties
-- the homepage's Best Sellers section, on top of the earlier products.created_at
-- gap (migration 0026) -- this is very likely most of what "categories are
-- not fully working" was pointing at.
--
-- No prior intentional ordering exists anywhere (column never existed), so
-- backfill alphabetically by name -- matches the ordering every other page
-- already uses (.order('name')), keeping New Arrivals/price-list consistent
-- with the rest of the catalog instead of introducing a different order.
ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT id, row_number() OVER (ORDER BY name) - 1 AS rn
  FROM categories
)
UPDATE categories
SET display_order = ranked.rn
FROM ranked
WHERE categories.id = ranked.id;
