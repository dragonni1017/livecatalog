-- Track stock-decrement fulfillment as its own one-way fact, decoupled from
-- order_requests.status -- same reasoning as entered_in_qb/entered_in_qb_at
-- (migration 0005): status can be flipped back and forth (converted ->
-- contacted -> converted again is a real admin workflow), but "did we
-- already pull this order's stock" must never re-fire on a later
-- transition back into 'converted'.
--
-- Found live 2026-08-21: the original guard compared against the
-- *previous* status value (current.status !== 'converted'), which only
-- blocks an exact repeated PATCH while status is already 'converted' --
-- a converted -> contacted -> converted round trip re-passed the guard and
-- decremented the same order's stock a second time. Confirmed via a real
-- test order: SKU 3D801155 went 432 -> 429 -> 426 (should have stayed at
-- 429 after the second conversion). Restored to 432 by hand after
-- confirming the bug, then this column + the corrected guard added.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once. No migration runner in this project.

alter table order_requests add column stock_decremented_at timestamptz;
