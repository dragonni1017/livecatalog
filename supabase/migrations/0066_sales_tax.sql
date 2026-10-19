-- Estimated sales tax by ship-to state (docs/SALES-TAX-PLAN.md, lib/sales-tax.ts).
-- The app only ESTIMATES tax for quotes; QuickBooks Desktop charges the real
-- tax on the invoice, and no tax amount is ever sent to it.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once, then confirm the table and the four order_requests columns
-- exist before deploying.
--
-- sales_tax_states: one rate per state, set at /admin/sales-tax. Starts EMPTY,
-- and a state with no active row is "not collected", so nothing buyers see
-- changes until someone fills it in. Server-read only (secret-key client):
-- RLS on, no policies.
--
-- order_requests: a snapshot of the estimate at submit time, like the line
-- prices. All nullable; existing orders stay null = "no estimate".

create table if not exists sales_tax_states (
  state         text primary key check (state ~ '^[A-Z]{2}$'),
  rate_percent  numeric(6,4) not null check (rate_percent >= 0 and rate_percent <= 20),
  is_active     boolean not null default true,
  note          text check (note is null or char_length(note) <= 200),
  updated_at    timestamptz not null default now(),
  updated_by    text
);

alter table sales_tax_states enable row level security;

alter table order_requests
  add column if not exists tax_state          text check (tax_state is null or tax_state ~ '^[A-Z]{2}$'),
  add column if not exists tax_rate_percent   numeric(6,4) check (tax_rate_percent is null or (tax_rate_percent >= 0 and tax_rate_percent <= 20)),
  add column if not exists tax_estimate_cents integer check (tax_estimate_cents is null or tax_estimate_cents >= 0),
  add column if not exists tax_exempt_reason  text check (tax_exempt_reason is null or tax_exempt_reason in ('resale_certificate', 'not_collected'));

-- Grants: looped over pg_roles (see CLAUDE.md / 0046).
do $$
declare
  role_name text;
begin
  foreach role_name in array array['anon', 'authenticated', 'service_role', 'postgres', 'authenticator']
  loop
    if exists (select 1 from pg_roles where rolname = role_name) then
      execute format('grant all privileges on table sales_tax_states to %I', role_name);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

comment on table sales_tax_states is
  'Estimated sales tax rate per ship-to state. Server-only; see migration 0066 and lib/sales-tax.ts.';
