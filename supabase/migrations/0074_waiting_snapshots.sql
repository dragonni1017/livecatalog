-- Waiting-queue snapshots (/admin/waiting, lib/waiting-trend.ts).
--
-- One row per queue per Los Angeles calendar day: how many items it had.
-- Written when the Waiting page loads and by the Monday cron, so the page
-- can show "since last week" for each queue. Today's row is overwritten
-- on each load; older days stay as they were.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project
-- aguorduaxfqrvvywgrdi) and run once. Then confirm the table exists.
--
-- Server-read only (secret-key client): RLS on, no policies.

create table if not exists waiting_snapshots (
  day        date not null,
  queue      text not null,
  count      integer not null,
  updated_at timestamptz not null default now(),
  primary key (day, queue)
);

alter table waiting_snapshots
  enable row level security;

do $$
declare
  role_name text;
begin
  foreach role_name in array array[
    'anon', 'authenticated', 'service_role',
    'postgres', 'authenticator'
  ]
  loop
    if exists (select 1 from pg_roles
               where rolname = role_name) then
      execute format(
        'grant all privileges on table '
        || 'waiting_snapshots to %I',
        role_name);
    end if;
  end loop;
end $$;
