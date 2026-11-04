-- Case-count review queue (/admin/case-count-review,
-- lib/case-count-review.ts).
--
-- One row per product whose case count (pieces per case, from the
-- pack spec in its name) disagrees with other evidence: shipments,
-- QuickBooks, the photo label. The evidence is stored as a list so
-- the owner sees every source side by side. Approving renames the
-- product through lib/product-name-fix.ts (Erply, WooCommerce, then
-- the catalog, each guarded on current_name). Only the case part of
-- the pack spec may change. Rows are loaded by
-- scripts/load-case-count-review.ts.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project
-- aguorduaxfqrvvywgrdi) and run once. Then confirm the table exists.
--
-- Server-read only (secret-key client): RLS on, no policies.

create table if not exists case_count_review_items (
  id                  uuid primary key
                      default gen_random_uuid(),
  batch               text not null,
  product_id          text not null
                      references products(id)
                      on delete cascade,
  sku                 text not null,
  current_name        text not null,
  current_case_pieces integer,
  evidence            jsonb not null default '[]',
  reason              text not null default '',
  status              text not null default 'pending'
                      check (status in
                        ('pending', 'approved',
                         'skipped')),
  decided_name        text,
  result              text,
  decided_at          timestamptz,
  created_at          timestamptz not null
                      default now(),
  unique (batch, product_id)
);

create index if not exists
  case_count_review_items_status_idx
  on case_count_review_items (status);

alter table case_count_review_items
  enable row level security;

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
        'grant all privileges on table '
        || 'case_count_review_items to %I',
        role_name);
    end if;
  end loop;
end $$;
