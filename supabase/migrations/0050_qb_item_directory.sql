-- Pull QuickBooks' full existing ITEM list into our own DB, the same way
-- 0035 does for customers. QuickBooks Desktop is where new products get set
-- up by hand (Dragon, 2026-09-18), so its item descriptions are the best
-- source for naming a SKU that arrives on a container but isn't in the
-- catalog yet -- better than the Commercial Invoice, whose text is a customs
-- category ("Plush Toys Pig Style 60cm") rather than a product name
-- ("Pig Weighted Paw Calm-Panion Plush - 24inch - 12/cs").
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once. No migration runner in this project.

create table if not exists qb_item_directory (
  qb_item_list_id  text primary key,
  -- QuickBooks' own FullName, which for a sub-item is "Parent:Child"
  -- (e.g. "Backpack:F286716"). Kept verbatim for traceability.
  full_name        text not null,
  -- The last ":"-separated segment of full_name, which is the actual SKU.
  -- A QBD Item List export needed this stripped off 813 rows before it would
  -- match the catalog (scripts/fix-fullqbd-sku-prefixes.mjs) -- deriving it
  -- here means every consumer gets it right without repeating that fix.
  sku              text not null,
  -- SalesDesc on inventory items, SalesOrPurchase.Desc on non-inventory and
  -- service items -- normalised to one column by parseItemFullQueryRs.
  sales_desc       text,
  -- 'Inventory' | 'NonInventory' | 'Service' | ... , derived from which
  -- Item*Ret element QuickBooks returned.
  item_type        text,
  sales_price      numeric(12,2),
  is_active        boolean,
  pulled_at        timestamptz not null default now()
);
create index if not exists qb_item_directory_sku_idx on qb_item_directory (sku);
create index if not exists qb_item_directory_full_name_idx on qb_item_directory (full_name);

-- Singleton pull-state row, same shape and reasoning as
-- qb_customer_pull_state in 0035: iterator_id is QuickBooks' own iteratorID
-- for resuming a paged query, and it lives here rather than in qb_sessions
-- because Web Connector opens a new session on every poll.
create table if not exists qb_item_pull_state (
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
insert into qb_item_pull_state (id) values (1) on conflict (id) do nothing;

alter table qb_item_directory enable row level security;
alter table qb_item_pull_state enable row level security;
-- No anon/authenticated policies, and deliberately NO table grants mirroring
-- `products`. The root CLAUDE.md rule about copying products' grants exists
-- for tables the PUBLIC catalog reads with the anon key; products is
-- anon-readable, so mirroring it here would expose QuickBooks item and
-- pricing data to the storefront. These tables are only ever read through
-- getAdminClient()'s secret key, which is the same convention every other
-- qb_* table uses (0031, 0035) and is proven working by the customer pull.

-- New session kind used while a full item pull is in progress.
alter table qb_sessions drop constraint qb_sessions_pending_request_kind_check;
alter table qb_sessions add constraint qb_sessions_pending_request_kind_check
  check (pending_request_kind in ('customer_query','customer_add','item_query','item_add','sales_order_add','customer_full_query','item_full_query'));
