-- Catalog analytics (admin dashboard 4c) — see ROADMAP.md Agent 5c.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once. No migration runner in this project.
--
-- One row per tracked event: a product view or a search. Written by /api/track
-- (service-role, best-effort). Aggregated for the /admin/analytics page.

create table if not exists analytics_events (
  id          bigint generated always as identity primary key,
  type        text not null check (type in ('view', 'search')),
  product_id  text references products(id) on delete set null,  -- for 'view'
  term        text,                                             -- for 'search'
  created_at  timestamptz not null default now()
);

create index if not exists idx_analytics_type_created on analytics_events(type, created_at desc);
create index if not exists idx_analytics_product on analytics_events(product_id);

-- RLS on, no anon policies: events are inserted only via the service-role client
-- in /api/track, and read only by the admin analytics page (service role bypasses
-- RLS). The public never reads or writes this table directly.
alter table analytics_events enable row level security;
