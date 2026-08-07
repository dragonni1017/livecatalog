-- Mapping table for the Erply <-> WooCommerce customer/tier bridge
-- (app/api/webhooks/erply/customers, app/api/webhooks/woo/customers).
--
-- Why this table exists at all: matching customers by email alone breaks the
-- moment someone changes their email on one side but not the other, or has
-- no email (a known chunk of Erply's company-only customers). Storing the
-- link once means later syncs look up by erply_customer_id / woo_customer_id
-- instead of re-matching by email every time.
--
-- Unrelated to the existing `customers` table (migration 0012) — that one is
-- livecatalog's own quote-flow customer record (discount_percent, notes),
-- not an Erply or Woo identity. Do not merge the two.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once. No migration runner in this project.
--
-- APPLIED LIVE 2026-08-07 (project aguorduaxfqrvvywgrdi) -- the three
-- blockers from the original SCAFFOLDING note are resolved/moot: all 5
-- Wholesale Suite roles now exist, the third-party import never landed
-- (superseded by scripts/backfill-erply-customers-to-woo.mjs +
-- app/api/sync/customers/route.ts), and the sync design moved from
-- webhook-driven to a daily cron pull instead.

create table erply_woo_customer_links (
  id                 bigserial primary key,
  email              text not null,
  erply_customer_id  text,
  erply_tier         text,
  woo_customer_id    bigint,
  woo_role_slug      text,
  last_synced_at     timestamptz,
  last_sync_source   text check (last_sync_source in ('erply', 'woo')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index erply_woo_customer_links_email_idx
  on erply_woo_customer_links (lower(email));

create index erply_woo_customer_links_erply_id_idx
  on erply_woo_customer_links (erply_customer_id);

create index erply_woo_customer_links_woo_id_idx
  on erply_woo_customer_links (woo_customer_id);

-- Only ever written/read via the service-role key (cron + scripts/), never
-- from a client-side Supabase call -- RLS with no policies blocks anon/
-- authenticated access while service role (which bypasses RLS) is unaffected.
alter table erply_woo_customer_links enable row level security;
