-- "Entered in QuickBooks" marker for order requests.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once. No migration runner in this project.
--
-- Orthogonal to `status` (new/contacted/converted/lost): a worker flips this to
-- true once they've keyed the order into QuickBooks Desktop, so the team can see
-- what's been entered vs. still pending and avoid double-entry. entered_in_qb_at
-- snapshots when it was marked.

alter table order_requests
  add column if not exists entered_in_qb    boolean not null default false,
  add column if not exists entered_in_qb_at timestamptz;

create index if not exists idx_order_requests_entered_in_qb on order_requests(entered_in_qb);
