-- Funnel tracking for /admin/analytics (browse -> add to cart -> open cart
-- -> submit quote).
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once. Apply BEFORE merging/deploying the code: /api/track now writes
-- visitor_id on EVERY insert, so without this column all tracking fails,
-- existing product views and searches included. The route swallows the
-- error (it never breaks the public site), so the loss would be silent.
--
-- 1. visitor_id: an anonymous random id the browser keeps in localStorage
--    (lib/track.ts). No name or email. It's what lets the funnel say "of the
--    visitors who browsed, N added to cart" instead of four unrelated totals.
--    Null on every event recorded before this migration.
-- 2. Three new event types. 'view' and 'search' are unchanged.
--
-- Existing table, so no new grants are needed (see CLAUDE.md on new tables).

alter table analytics_events add column if not exists visitor_id text;

alter table analytics_events drop constraint if exists analytics_events_type_check;
alter table analytics_events add constraint analytics_events_type_check
  check (type in ('view', 'search', 'add_to_cart', 'cart_view', 'quote_submitted'));

create index if not exists idx_analytics_visitor_created
  on analytics_events(created_at desc, visitor_id)
  where visitor_id is not null;
