-- Owner questions (/admin/owner-questions, lib/owner-questions.ts).
--
-- One row per question for the owner that used to live in the
-- case-count handoff spreadsheet: QuickBooks fixes, pack questions and
-- photo-proofread flags. The owner types the answer on the screen; a
-- question whose answer is a new product name can be sent to Name
-- review (name_review_items), which renames through the usual audited
-- path. Rows are loaded by scripts/load-owner-questions.ts. Case-count
-- questions stay on /admin/case-count-review.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project
-- aguorduaxfqrvvywgrdi) and run once. Then confirm the table exists.
--
-- Server-read only (secret-key client): RLS on, no policies.

create table if not exists owner_questions (
  id           uuid primary key
               default gen_random_uuid(),
  batch        text not null,
  product_id   text
               references products(id)
               on delete set null,
  sku          text not null,
  kind         text not null,
  question     text not null,
  detail       text not null default '',
  answer       text,
  status       text not null default 'open'
               check (status in
                 ('open', 'answered', 'done')),
  answered_by  text,
  answered_at  timestamptz,
  created_at   timestamptz not null
               default now(),
  unique (batch, sku, kind)
);

create index if not exists
  owner_questions_status_idx
  on owner_questions (status);

alter table owner_questions
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
        || 'owner_questions to %I',
        role_name);
    end if;
  end loop;
end $$;
