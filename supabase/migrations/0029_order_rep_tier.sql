-- Rep + applied-tier attribution on order_requests.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once. No migration runner in this project.
--
-- rep_user_id: which rep (auth.users) account placed/priced the order, if any.
-- applied_tier_code / applied_tier_discount_percent: snapshot of the tier the
-- rep selected at submit time -- the percent is duplicated onto the order
-- (not just looked up live via applied_tier_code) so a later change to
-- price_tiers.discount_percent never rewrites what a past order was actually
-- priced at, same snapshotting rationale as order_items.unit_price_cents.

alter table order_requests
  add column if not exists rep_user_id                  uuid references auth.users(id),
  add column if not exists applied_tier_code             text references price_tiers(code),
  add column if not exists applied_tier_discount_percent numeric(5,2);

create index if not exists idx_order_requests_rep_user_id on order_requests(rep_user_id);
