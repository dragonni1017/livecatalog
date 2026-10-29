-- Name review queue (/admin/name-review, lib/name-review.ts).
--
-- One row per suggested product rename, with the reason. Approving a row
-- renames the product through lib/product-name-fix.ts, which writes Erply,
-- WooCommerce and the catalog in order, and refuses any system whose live
-- name no longer equals current_name. Rows are loaded by
-- scripts/load-name-review.ts from the owner's name-fix sheet.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project
-- aguorduaxfqrvvywgrdi) and run once. Then confirm the table exists.
--
-- Server-read only (secret-key client): RLS on, no policies.

create table if not exists name_review_items (
  id             uuid primary key default gen_random_uuid(),
  batch          text not null,
  product_id     text not null
                 references products(id) on delete cascade,
  sku            text not null,
  problem        text not null default '',
  reason         text not null default '',
  current_name   text not null,
  suggested_name text,
  status         text not null default 'pending'
                 check (status in
                   ('pending', 'approved', 'skipped')),
  decided_name   text,
  result         text,
  decided_at     timestamptz,
  created_at     timestamptz not null default now(),
  unique (batch, product_id)
);

create index if not exists name_review_items_status_idx
  on name_review_items (status);

alter table name_review_items enable row level security;

-- Grants, looped over pg_roles (CLAUDE.md: a missing role must not
-- abort the whole script).
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
        'grant all privileges on table name_review_items to %I',
        role_name);
    end if;
  end loop;
end $$;
