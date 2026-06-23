-- Import-history log (admin dashboard 4c) — see ROADMAP.md Agent 5c.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once. No migration runner in this project.
--
-- One row per Excel import run, recording the summary returned by /api/import.
-- Best-effort: a logging failure never fails the import itself.

create extension if not exists pgcrypto;

create table if not exists import_runs (
  id            uuid primary key default gen_random_uuid(),
  source        text not null default 'excel',   -- 'excel' | 'erply' | 'sync'
  rows_received integer not null default 0,
  inserted      integer not null default 0,
  updated       integer not null default 0,
  deactivated   integer not null default 0,
  skipped       integer not null default 0,
  error_count   integer not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists idx_import_runs_created_at on import_runs(created_at desc);

-- RLS on, no anon policies: writes/reads happen only through the service-role
-- client in /api/import and the admin pages (service role bypasses RLS).
alter table import_runs enable row level security;
