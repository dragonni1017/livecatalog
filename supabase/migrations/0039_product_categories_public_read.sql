-- HOW TO APPLY: paste into the Supabase SQL editor and run. Not applied via CLI.
--
-- Bug found live immediately after 0038: product_categories was created
-- with RLS enabled but zero policies, so the public catalog's anon-key
-- client (app/(catalog)/page.tsx) got zero rows back from it -- category
-- browsing returned "0 products" for every category, not just multi-
-- category ones. products and categories both already carry a "Public can
-- read" SELECT policy (roles: public, qual: true); this adds the same one
-- here so product_categories is readable at the same visibility level as
-- the tables it just joins.

create policy "Public can read product_categories"
  on product_categories
  for select
  to public
  using (true);
