-- Widen qb_sessions.pending_request_kind to support auto-creating a
-- customer/item in QuickBooks when a name-filtered lookup finds no match,
-- instead of erroring the sync out (see app/api/qbwc/route.ts).
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once. No migration runner in this project.

alter table qb_sessions drop constraint qb_sessions_pending_request_kind_check;
alter table qb_sessions add constraint qb_sessions_pending_request_kind_check
  check (pending_request_kind in ('customer_query','customer_add','item_query','item_add','sales_order_add'));
