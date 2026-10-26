-- 0067: products.awaiting_price -- "hidden only because it has no price yet".
--
-- manually_hidden says nothing about WHY a product is hidden, and ~2,000
-- priced products are hidden on purpose. So the Needs pricing tab's "Ready to
-- show" list could only offer products from the receiving cohort
-- (lib/needs-pricing.ts), and the 60 unpriced products created another way
-- (QuickBooks-created tumblers and keychains, 2026-10-06, and older) would
-- have stayed hidden forever once priced.
--
-- Set true wherever the system hides a product for having no price (the
-- Erply sync's insert, receiving's to-catalog route, the QuickBooks create
-- scripts). Cleared by any deliberate visibility change: the Ready to show
-- unhide, and the /admin/products toggle. It never unhides anything itself.
--
-- No grants: a new column on an existing table inherits the table's grants.

alter table public.products
  add column if not exists awaiting_price boolean not null default false;

-- Backfill: every active product hidden at no price today. All 148 on
-- 2026-10-23 were hidden by the zero-price guard, none by choice.
update public.products
   set awaiting_price = true
 where is_active
   and manually_hidden
   and coalesce(price_cents, 0) <= 0;
