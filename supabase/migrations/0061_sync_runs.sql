-- History of Erply → catalog sync runs (the nightly /api/sync cron and the
-- admin "Sync Now" button), shown on /admin/sync.
--
-- Why: on Vercel Hobby, runtime logs are kept for one hour. The cron runs at
-- 08:00 UTC (1 AM Pacific), so by morning its summary and errors are gone and
-- a failed night leaves no trace. Each run now writes one row here.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once. Server-only table (secret-key client), so RLS on, no policies.

create table if not exists sync_runs (
  id             bigint generated always as identity primary key,
  source         text not null check (source in ('cron', 'manual')),
  status         text not null check (status in ('ok', 'partial', 'error', 'skipped')),
  started_at     timestamptz not null,
  finished_at    timestamptz not null default now(),
  duration_ms    integer,
  inserted       integer not null default 0,
  updated        integer not null default 0,
  deactivated    integer not null default 0,
  error_count    integer not null default 0,
  -- First errors only (bounded in lib/sync-runs.ts), plus the stock / low-stock
  -- / abandoned-cart sub-results and any top-level failure message.
  errors         jsonb,
  details        jsonb,
  message        text
);

create index if not exists idx_sync_runs_started on sync_runs(started_at desc);

alter table sync_runs enable row level security;

-- Grants (see CLAUDE.md / 0046): looped over pg_roles, since this project has
-- no service_role role and a multi-role grant naming a missing role fails
-- entirely (and rolls back the create table in the SQL editor's transaction).
do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role', 'postgres', 'authenticator']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('grant all privileges on table sync_runs to %I', role_name);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

comment on table sync_runs is
  'One row per Erply sync run (cron or manual). Written by lib/sync-runs.ts; read on /admin/sync. See migration 0061.';
