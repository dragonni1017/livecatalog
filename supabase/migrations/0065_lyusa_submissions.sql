-- Which SKUs have gone out in a LYUSA item-import batch, and in which one.
-- Written by scripts/lyusa-mark-sent.ts after a batch is sent; read by
-- scripts/lyusa-batch.ts, which leaves out every SKU with a row here.
-- One row per (sku, batch), so a product re-sent later keeps its history.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once, then confirm the table exists before running the scripts.
--
-- Script-only (secret-key client): RLS on, no policies. No FK to products:
-- the record of what was sent stays true even if a SKU is later renamed or
-- deleted.

create table if not exists lyusa_submissions (
  sku         text not null,
  batch       text not null check (batch ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  sent_at     timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  primary key (sku, batch)
);

create index if not exists lyusa_submissions_batch_idx on lyusa_submissions (batch);

alter table lyusa_submissions enable row level security;

-- Grants: looped over pg_roles (see CLAUDE.md / 0046).
do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role', 'postgres', 'authenticator']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('grant all privileges on table lyusa_submissions to %I', role_name);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

comment on table lyusa_submissions is
  'SKUs sent to LYUSA per item-import batch. Script-only; see migration 0065 and scripts/lyusa-batch.ts.';
