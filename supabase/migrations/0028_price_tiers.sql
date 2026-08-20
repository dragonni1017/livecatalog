-- Named price tiers for rep-placed orders.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once. No migration runner in this project.
--
-- Mirrors the 5 customer-group tiers already live in Erply (see
-- docs/memory/project-retail-anchor-pricing-flip.md) so a rep can price an
-- order at the same named tier a customer would be assigned there. Retail is
-- the anchor (0% off); the others are real discounts off Retail, not markups.

create table if not exists price_tiers (
  code              text primary key,   -- 'retail' | 'wholesale' | 'distribution_chain' | 'exclusive' | 'base'
  label             text not null,
  discount_percent  numeric(5,2) not null default 0
                       check (discount_percent >= 0 and discount_percent <= 100),
  display_order     int not null default 0,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

insert into price_tiers (code, label, discount_percent, display_order) values
  ('retail', 'Retail', 0, 1),
  ('wholesale', 'Wholesale', 50, 2),
  ('distribution_chain', 'Distribution Chain', 54, 3),
  ('exclusive', 'Exclusive', 38, 4),
  ('base', 'Base', 0, 5)
on conflict (code) do nothing;

alter table price_tiers enable row level security;
-- No anon/authenticated policies -- read exclusively via getAdminClient()
-- (service role) from server components/routes, same convention as
-- order_requests/order_items (0001_order_requests.sql).
