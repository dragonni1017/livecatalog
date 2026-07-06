-- Back-in-stock notification requests.
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi) and run once.

create table if not exists back_in_stock_requests (
  id          bigint generated always as identity primary key,
  product_id  text not null references products(id) on delete cascade,
  email       text not null,
  created_at  timestamptz not null default now(),
  notified_at timestamptz,
  unique(product_id, email)
);

create index if not exists idx_bis_product_pending
  on back_in_stock_requests(product_id)
  where notified_at is null;

alter table back_in_stock_requests enable row level security;
-- No anon policies — all reads/writes go through service-role in /api/back-in-stock.
