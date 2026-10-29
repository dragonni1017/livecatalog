-- A catalog-set price that the Erply sync keeps until Erply catches up.
--
-- Prices are entered by hand in Erply (the API can't set one on this account,
-- proven 2026-09-16) and the sync owns price_cents, so a price changed in the
-- catalog was overwritten by the next daily sync. When held_price_cents is
-- set, lib/product-sync.ts keeps price_cents at the held value whatever Erply
-- sends, and clears the hold on the first sync where Erply's price equals it.
-- From then on Erply owns the price again.
--
-- New column on an existing table: it inherits the table's grants, so no
-- grant statements are needed (CLAUDE.md, the bins/bin_types trap).
alter table products
  add column if not exists held_price_cents integer
    check (held_price_cents is null or held_price_cents > 0);

comment on column products.held_price_cents is
  'Catalog-set price kept by the Erply sync until Erply''s price equals it; then cleared. Null = Erply owns the price.';
