-- customers (migration 0012) was written but never actually applied to the
-- live database -- app/api/orders/route.ts and app/admin/orders/[id]/page.tsx
-- have been querying a table that didn't exist this whole time (silently:
-- buyer-file discounts never applied, admin's "Buyer Discount on File"
-- section always fell back to its not-found branch). Applying 0012 now,
-- verbatim, alongside this file.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once, after 0012_customers.sql. No migration runner in this project.
--
-- 0012 didn't enable RLS -- every other table in this schema does (service-role
-- only, no anon/authenticated policies, same convention as order_requests/
-- qb_sync_queue/etc). All customers access already goes through
-- getAdminClient() (app/admin/api/customers/route.ts, app/api/orders/route.ts,
-- app/admin/orders/[id]/page.tsx), so this closes the gap for defense in depth
-- rather than fixing an active hole -- same spirit as 0025's lock-down pass,
-- just for a table instead of a function.

alter table customers enable row level security;
