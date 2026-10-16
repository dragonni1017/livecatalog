-- Curated / seasonal collections ("Valentine's", "Graduation"): admin-picked
-- product groups with their own page at /collections/<slug>, listed in the
-- catalog nav while live. Managed at /admin/collections.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once, then confirm both tables exist before deploying.
--
-- Read ONLY on the server with the secret-key client (like shipments for
-- /new-arrivals), so RLS is on with no policies on purpose: there is no
-- anon read path to forget a public SELECT policy for (see CLAUDE.md).

create table if not exists collections (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  name           text not null check (char_length(name) between 1 and 80),
  description    text check (description is null or char_length(description) <= 500),
  is_active      boolean not null default true,
  -- Optional seasonal window, inclusive. Null = open-ended on that side.
  starts_on      date,
  ends_on        date,
  display_order  integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (starts_on is null or ends_on is null or starts_on <= ends_on)
);

create table if not exists collection_products (
  collection_id  uuid not null references collections(id) on delete cascade,
  product_id     text not null references products(id) on delete cascade,
  position       integer not null default 0,
  added_at       timestamptz not null default now(),
  primary key (collection_id, product_id)
);

create index if not exists idx_collection_products_order on collection_products(collection_id, position);
create index if not exists idx_collection_products_product on collection_products(product_id);

alter table collections enable row level security;
alter table collection_products enable row level security;

-- Grants, required for PostgREST to see the tables at all (see CLAUDE.md and
-- 0046). Looped over pg_roles because this project has no service_role role,
-- and a multi-role grant naming a missing role fails entirely and, in the SQL
-- editor's single transaction, rolls back the create tables above.
do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role', 'postgres', 'authenticator']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('grant all privileges on table collections to %I', role_name);
      execute format('grant all privileges on table collection_products to %I', role_name);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

comment on table collections is
  'Curated/seasonal product collections. Live = is_active and today within [starts_on, ends_on] (nulls open). Server-read only; see migration 0059.';
comment on table collection_products is
  'Products in a collection, in display order (position). Cascades when either side is deleted.';
