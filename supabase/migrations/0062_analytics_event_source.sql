-- Where a tracked event came from, e.g. 'qr' for a product view opened by
-- scanning a printed line card (line-card QR links carry ?src=qr). Read by
-- the "From printed line cards" row on /admin/analytics.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once. Apply BEFORE deploying: /api/track writes this column on
-- every insert, and a missing column fails ALL tracking silently (the route
-- swallows insert errors), the same trap as 0056.
--
-- Existing table: no grant or policy changes.

alter table analytics_events add column if not exists source text
  check (source is null or source ~ '^[a-z_]{1,32}$');

create index if not exists idx_analytics_source_created
  on analytics_events(created_at desc)
  where source is not null;
