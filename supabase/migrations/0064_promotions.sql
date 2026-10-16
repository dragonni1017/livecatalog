-- Promo codes (lib/promotions.ts): percent off, optionally limited to a date
-- window, one collection or category, a minimum order and a usage cap.
-- Combined with tier/customer pricing as "better of the two" per line, never
-- stacked. Managed at /admin/promotions; entered by buyers in the cart.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once, then confirm the table, columns and functions exist before
-- deploying.
--
-- Server-read only (secret-key client): RLS on, no policies. The use counter
-- is claimed atomically by claim_promotion_use(), and EXECUTE on both
-- functions is revoked from anon/authenticated so the public key can't burn a
-- code's uses through PostgREST.

create table if not exists promotions (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique check (code ~ '^[A-Z0-9_-]{3,32}$'),
  name                 text not null check (char_length(name) between 1 and 80),
  percent_off          numeric(5,2) not null check (percent_off > 0 and percent_off <= 90),
  is_active            boolean not null default true,
  starts_on            date,
  ends_on              date,
  scope_kind           text not null default 'all' check (scope_kind in ('all', 'collection', 'category')),
  scope_collection_id  uuid references collections(id) on delete set null,
  scope_category_id    text references categories(id) on delete set null,
  min_subtotal_cents   integer check (min_subtotal_cents is null or min_subtotal_cents >= 0),
  max_uses             integer check (max_uses is null or max_uses > 0),
  times_used           integer not null default 0 check (times_used >= 0),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (starts_on is null or ends_on is null or starts_on <= ends_on),
  check (scope_kind <> 'collection' or scope_collection_id is not null),
  check (scope_kind <> 'category' or scope_category_id is not null)
);

alter table promotions enable row level security;

alter table order_requests add column if not exists promo_code text;
alter table order_requests add column if not exists promo_discount_cents integer;

-- Atomically take one use if the cap allows. Returns true when claimed.
create or replace function claim_promotion_use(p_id uuid) returns boolean
language sql volatile as $$
  with u as (
    update promotions set times_used = times_used + 1
    where id = p_id and (max_uses is null or times_used < max_uses)
    returning 1
  )
  select exists (select 1 from u)
$$;

-- Give a use back (the order insert failed after a claim).
create or replace function release_promotion_use(p_id uuid) returns void
language sql volatile as $$
  update promotions set times_used = greatest(times_used - 1, 0) where id = p_id
$$;

-- Grants. Table: looped over pg_roles (see CLAUDE.md / 0046). Functions:
-- revoked from public/anon/authenticated, granted only to server roles.
do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role', 'postgres', 'authenticator']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('grant all privileges on table promotions to %I', role_name);
    end if;
  end loop;

  revoke all on function claim_promotion_use(uuid) from public;
  revoke all on function release_promotion_use(uuid) from public;
  foreach role_name in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('revoke all on function claim_promotion_use(uuid) from %I', role_name);
      execute format('revoke all on function release_promotion_use(uuid) from %I', role_name);
    end if;
  end loop;
  foreach role_name in array array['service_role', 'postgres']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('grant execute on function claim_promotion_use(uuid) to %I', role_name);
      execute format('grant execute on function release_promotion_use(uuid) to %I', role_name);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

comment on table promotions is
  'Promo codes: percent off, optional window/scope/min/cap. Better-of with tier pricing, never stacked. Server-only; see migration 0064 and lib/promotions.ts.';
