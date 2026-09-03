-- Lets admin assign a customer directly to a named price tier
-- (price_tiers.code), so that customer's account gets that tier's pricing
-- automatically -- no rep needed to pick it per order, and no login
-- required either (checkout resolves it the same way the existing
-- customers.discount_percent flat discount already does: by the order's
-- email, see app/api/orders/route.ts). Logged-in customers additionally see
-- their tier-adjusted price live while browsing (see
-- app/api/customer/tier/route.ts + components/catalog/TierSwitcher.tsx).
--
-- When both an assigned tier and a flat discount_percent are present on the
-- same customer, the tier wins -- never stacked, same "override, not stack"
-- precedent as rep-selected tier vs customer discount in
-- app/api/orders/route.ts.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once. No migration runner in this project.

alter table customers
  add column if not exists price_tier_code text references price_tiers(code);
