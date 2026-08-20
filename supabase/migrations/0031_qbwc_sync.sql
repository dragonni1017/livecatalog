-- QuickBooks Web Connector (QBWC) sync schema.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once. No migration runner in this project.
--
-- QB Desktop has no cloud API -- this backs a SOAP endpoint (app/api/qbwc/route.ts)
-- that Intuit's QuickBooks Web Connector polls from the Windows machine running
-- QB Desktop. See docs/memory/project-rep-price-tier-and-qbwc-plan.md for the
-- full design and the approved plan it points to.

-- One row per order queued for QuickBooks entry. UNIQUE on order_id is the
-- idempotency backbone: enqueue is automatic on order_requests.status ->
-- 'converted' (see app/admin/api/orders/route.ts), so ON CONFLICT DO NOTHING
-- on insert guarantees a re-triggered status write can never create two rows
-- for one order.
create table if not exists qb_sync_queue (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references order_requests(id),
  status           text not null default 'pending'
                     check (status in ('pending','sent','acked','error')),
  qbxml_request    text,
  qbxml_response   text,
  error_message    text,
  attempt_count    int not null default 0,
  last_attempt_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists qb_sync_queue_order_id_idx on qb_sync_queue(order_id);

-- QuickBooks has no email field usable as a query filter (CustomerQueryRq only
-- filters by Name/ListID), so these are populated via a name-based lookup
-- against QuickBooks, keyed here by OUR join key (lowercased email) once
-- resolved -- not looked up by email in QuickBooks itself. Mirrors the shape
-- of erply_woo_customer_links (migration 0019).
create table if not exists qb_customer_links (
  email                  text primary key,
  qb_customer_list_id    text,
  qb_customer_full_name  text,
  last_synced_at         timestamptz,
  last_sync_source       text check (last_sync_source in ('qbwc_pull','manual'))
);

-- Assumes the QuickBooks item's Name equals our products.sku -- verify
-- against the real company file once hardware testing starts.
create table if not exists qb_item_links (
  sku                text primary key,
  qb_item_list_id    text,
  qb_item_full_name  text,
  last_synced_at     timestamptz,
  last_sync_source   text check (last_sync_source in ('qbwc_pull','manual'))
);

-- QBWC's protocol is a stateful "conversation" keyed by a session ticket
-- (authenticate -> repeated sendRequestXML/receiveResponseXML -> closeConnection).
-- This app runs on Vercel serverless functions -- an in-memory ticket map (the
-- shape of most QBWC sample code, written for an always-on IIS host) would not
-- survive cold starts or concurrent invocations, so session + in-flight-request
-- state lives here instead. pending_request_kind/pending_order_id/pending_ref
-- record what sendRequestXML most recently asked QuickBooks for, so the next
-- receiveResponseXML call (which gets no context of its own) knows how to
-- interpret the response.
create table if not exists qb_sessions (
  ticket                text primary key,
  opened_at             timestamptz not null default now(),
  pending_request_kind  text check (pending_request_kind in ('customer_query','item_query','sales_order_add')),
  pending_order_id      uuid references order_requests(id),
  pending_ref           text,
  closed_at             timestamptz
);

alter table qb_sync_queue enable row level security;
alter table qb_customer_links enable row level security;
alter table qb_item_links enable row level security;
alter table qb_sessions enable row level security;
-- No anon/authenticated policies -- service-role only (getAdminClient()),
-- same convention as order_requests/order_items (0001) and
-- erply_woo_customer_links (0019). The QBWC SOAP endpoint authenticates
-- callers itself (QBWC_USERNAME/QBWC_PASSWORD) rather than via Supabase RLS.
