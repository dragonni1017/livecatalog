-- Ship-to address book for signed-in customers. Managed on /account and
-- picked from in the cart (/api/account/addresses).
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once, then confirm the table exists before deploying.
--
-- Orders don't reference this table. The cart copies the chosen address into
-- order_requests.ship_* as before (0034), so editing or deleting a saved
-- address never changes a past order or what goes to QuickBooks.

create table if not exists customer_addresses (
  id          uuid primary key default gen_random_uuid(),
  -- auth.users id. No FK into the auth schema; the API only ever writes the
  -- session user's id.
  user_id     uuid not null,
  label       text check (label is null or char_length(label) <= 60),
  address1    text not null check (char_length(address1) between 1 and 200),
  address2    text check (address2 is null or char_length(address2) <= 200),
  city        text not null check (char_length(city) between 1 and 100),
  state       text not null check (char_length(state) between 1 and 50),
  zip         text not null check (char_length(zip) between 1 and 20),
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_customer_addresses_user on customer_addresses(user_id);
-- At most one default per customer.
create unique index if not exists uq_customer_addresses_one_default
  on customer_addresses(user_id) where is_default;

-- RLS on with NO policies: only the server's secret-key client touches rows.
alter table customer_addresses enable row level security;

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
      execute format('grant all privileges on table customer_addresses to %I', role_name);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

comment on table customer_addresses is
  'Signed-in customers'' saved ship-to addresses. The cart copies one into order_requests.ship_*; orders never reference this table. See migration 0058.';
