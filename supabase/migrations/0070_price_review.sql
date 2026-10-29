-- Price review queue (/admin/price-review, lib/price-review.ts).
--
-- One row per product whose price needs a decision, with a suggested
-- website price and the reason. Approving a row sets products.price_cents
-- and products.held_price_cents together (0068), so the Erply sync keeps the
-- price until Erply matches, and writes an audit_log row first. Rows are
-- loaded by scripts/load-price-review.ts from a review sheet.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project
-- aguorduaxfqrvvywgrdi) and run once. Then confirm the table exists before
-- merging the code that reads it.
--
-- Server-read only (secret-key client): RLS on, no policies.

create table if not exists price_review_items (
  id              uuid primary key default gen_random_uuid(),
  batch           text not null,
  product_id      text not null
                  references products(id) on delete cascade,
  sku             text not null,
  grp             text not null default '',
  note            text not null default '',
  reason          text not null default '',
  file_cents      integer,
  website_cents   integer,
  suggested_cents integer
                  check (suggested_cents is null
                         or suggested_cents > 0),
  status          text not null default 'pending'
                  check (status in
                    ('pending', 'approved', 'skipped')),
  decided_cents   integer
                  check (decided_cents is null
                         or decided_cents > 0),
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  unique (batch, product_id)
);

create index if not exists price_review_items_status_idx
  on price_review_items (status);

alter table price_review_items enable row level security;

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
        'grant all privileges on table price_review_items to %I',
        role_name);
    end if;
  end loop;
end $$;
