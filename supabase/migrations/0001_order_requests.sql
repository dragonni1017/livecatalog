-- Cart + Sales Order Request feature — see CART-AND-SALES-ORDER-PLAN.md
--
-- HOW TO APPLY: this project has no migration runner. Paste this whole file
-- into the Supabase SQL editor (project aguorduaxfqrvvywgrdi) and run it once.
--
-- Two tables: an order_request (the quote request) and its snapshotted line
-- items. Prices/names are snapshotted onto order_items at submit time so an
-- old order shows what the customer was quoted, not today's catalog price.
--
-- products.id is TEXT (e.g. 'prod-00029'), so order_items.product_id is TEXT.

create extension if not exists pgcrypto;

create table if not exists order_requests (
  id                 uuid primary key default gen_random_uuid(),
  reference_code     text unique not null,            -- e.g. ORD-2026-0042
  status             text not null default 'new'
                       check (status in ('new', 'contacted', 'converted', 'lost')),
  customer_name      text not null,
  customer_email     text not null,
  customer_phone     text,
  customer_company   text,
  notes              text,
  subtotal_cents     integer not null default 0,
  assigned_rep_email text,                            -- Phase 2 routing (unused in v1)
  status_changed_by  text,                            -- which admin last changed status
  status_changed_at  timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);


create table if not exists order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references order_requests(id) on delete cascade,
  -- nullable + SET NULL: keep the historical line even if the product is later
  -- deleted; the sku/name/price snapshot below preserves what was ordered.
  product_id       text references products(id) on delete set null,
  sku              text not null,
  name             text not null,
  unit_price_cents integer not null,
  qty              integer not null check (qty > 0),
  line_total_cents integer not null
);

create index if not exists idx_order_items_order_id      on order_items(order_id);
create index if not exists idx_order_requests_status     on order_requests(status);
create index if not exists idx_order_requests_created_at on order_requests(created_at desc);

-- RLS: lock both tables down completely to the public/anon role. Unlike the
-- plan's "public can INSERT" note, we insert exclusively through /api/orders
-- using the service-role client (which bypasses RLS). That route re-fetches
-- prices server-side, so allowing direct anon inserts would only open a door
-- to price-tampering/spam with no benefit. Service role does all reads/writes.
alter table order_requests enable row level security;
alter table order_items    enable row level security;
-- (No anon policies created on purpose → anon can neither SELECT nor INSERT.)
