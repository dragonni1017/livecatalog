-- Resale / tax-exempt certificates uploaded by signed-in customers on
-- /account, reviewed on /admin/resale-certificates and shown on the admin
-- order detail page.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once, then confirm the table and bucket exist before deploying.
--
-- Files hold tax IDs and business addresses, so they live in a PRIVATE bucket
-- (product photos use the public `product-images` one). Nobody reads them
-- directly: customers upload through a signed upload URL minted by
-- /api/account/resale-certificate, and admins view through a 5-minute signed
-- URL from /admin/api/resale-certificates/<id>/file. Both use the server's
-- secret-key client, so the bucket needs no storage policies.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'resale-certificates',
  'resale-certificates',
  false,
  10485760, -- 10 MB
  array['application/pdf', 'image/jpeg', 'image/png']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create table if not exists resale_certificates (
  id             uuid primary key default gen_random_uuid(),
  -- auth.users id of the uploader. No FK into the auth schema, to keep this
  -- migration self-contained; the API only ever writes the session user's id.
  user_id        uuid not null,
  -- Lowercased. Orders are matched by email (order_requests.customer_email),
  -- so this is what links a certificate to an order.
  email          text not null check (email = lower(email)),
  file_path      text not null unique,   -- '<user_id>/<uuid>.<ext>' in the bucket
  file_name      text,                   -- original name, for display only
  state          text not null check (state ~ '^[A-Z]{2}$'),
  permit_number  text not null check (char_length(permit_number) between 1 and 64),
  expires_on     date,                   -- null = no expiry printed on it
  status         text not null default 'pending'
                   check (status in ('pending', 'verified', 'rejected')),
  review_notes   text,
  reviewed_by    text,
  reviewed_at    timestamptz,
  -- Set when the customer uploads a newer certificate. The active one is the
  -- row with replaced_at null; older rows stay as history.
  replaced_at    timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists idx_resale_certs_active_email
  on resale_certificates(email) where replaced_at is null;
create index if not exists idx_resale_certs_user on resale_certificates(user_id);

-- RLS on with NO policies: anon/authenticated can't read or write a row.
-- Only the server's secret-key client touches this table.
alter table resale_certificates enable row level security;

-- Grants, required for PostgREST to see the table at all (see CLAUDE.md and
-- 0046). Looped over pg_roles because this project has no service_role role,
-- and a multi-role grant naming a missing role fails entirely and, in the SQL
-- editor's single transaction, rolls back the create table above.
do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role', 'postgres', 'authenticator']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('grant all privileges on table resale_certificates to %I', role_name);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

comment on table resale_certificates is
  'Customer resale/tax-exempt certificates. Files in the private resale-certificates bucket. Review status is a record only: nothing downstream (pricing, QuickBooks tax) reads it. See migration 0057.';
