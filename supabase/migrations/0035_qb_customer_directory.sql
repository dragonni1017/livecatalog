-- Pull QuickBooks' full existing customer list into our own DB so admin can
-- manually link a real customer's email to their existing QuickBooks record
-- BEFORE their first order auto-syncs -- avoids the duplicate-customer risk
-- of CustomerQueryRq's name-only (no email) lookup guessing wrong on a
-- first-time name mismatch. See docs/memory/project-rep-price-tier-and-qbwc-plan.md.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once. No migration runner in this project.

create table if not exists qb_customer_directory (
  qb_customer_list_id  text primary key,
  full_name            text not null,
  company_name         text,
  email                text,
  phone                text,
  pulled_at            timestamptz not null default now()
);
create index if not exists qb_customer_directory_full_name_idx on qb_customer_directory (full_name);
create index if not exists qb_customer_directory_email_idx on qb_customer_directory (email);

-- Singleton row (same pattern as display_settings, migration 0017) tracking
-- an admin-triggered, possibly multi-poll-cycle pull of QuickBooks' full
-- customer list via CustomerQueryRq's iterator protocol. iterator_id is
-- QuickBooks' own iteratorID for resuming a paged query -- persisted here
-- (not in qb_sessions) so the pull survives across separate QBWC
-- authenticate() tickets, since Web Connector opens a new session each poll.
create table if not exists qb_customer_pull_state (
  id             integer primary key default 1 check (id = 1),
  status         text not null default 'idle'
                   check (status in ('idle','requested','in_progress','done','error')),
  iterator_id    text,
  pulled_count   integer not null default 0,
  error_message  text,
  requested_at   timestamptz,
  completed_at   timestamptz,
  updated_at     timestamptz not null default now()
);
insert into qb_customer_pull_state (id) values (1) on conflict (id) do nothing;

alter table qb_customer_directory enable row level security;
alter table qb_customer_pull_state enable row level security;
-- No anon/authenticated policies -- service-role only (getAdminClient()),
-- same convention as the rest of the qb_* tables (0031).

-- Add the new session kind used while a full customer pull is in progress.
alter table qb_sessions drop constraint qb_sessions_pending_request_kind_check;
alter table qb_sessions add constraint qb_sessions_pending_request_kind_check
  check (pending_request_kind in ('customer_query','customer_add','item_query','item_add','sales_order_add','customer_full_query'));
