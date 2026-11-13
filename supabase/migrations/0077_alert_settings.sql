-- Admin alert settings (lib/alert-settings.ts).
--
-- One-row table of switches for the app's own alert emails. First switch:
-- the low-stock reorder email (lib/low-stock-alert.ts), toggled from
-- /admin/products. Off = no email; products still get marked alerted, so
-- turning it back on doesn't send everything that went low meanwhile.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project
-- aguorduaxfqrvvywgrdi) and run once. Then confirm the row exists:
--   select * from alert_settings;
-- Until it runs, the email stays on (the code defaults to on).
--
-- Server-read only (secret-key client): RLS on, no policies.

create table if not exists alert_settings (
  id                      integer primary key default 1 check (id = 1),
  low_stock_email_enabled boolean not null default true,
  updated_at              timestamptz not null default now()
);

insert into alert_settings (id) values (1)
  on conflict (id) do nothing;

alter table alert_settings
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
        || 'alert_settings to %I',
        role_name);
    end if;
  end loop;
end $$;
