-- Receiving Phase 2: turn a shipment's unmatched SKUs into real products.
--
-- A packing list carries no English name, no category and no selling price,
-- which is why Phase 1 staged unmatched SKUs and refused to create anything
-- (Dragon's call 2026-09-14, kept). The English DOES exist on the container's
-- Commercial Invoice, in customs phrasing, joined to the packing list by
-- cartons + pieces -- see lib/commercial-invoice.ts for why that join is
-- arithmetic rather than by SKU (the invoice has no SKU column at all, and
-- its rows group colourways).
--
-- So these columns hold a PROPOSAL, not a fact: what the invoice said, what
-- the generator suggests, and what the admin actually approved. Creation in
-- Erply is recorded per line, the same one-way-fact pattern as
-- shipment_lines.applied_at, so a half-finished batch can be resumed without
-- creating a product twice.
--
-- Products are created in ERPLY, never directly in products: the catalog's
-- name/price/category are overwritten from Erply on every sync
-- (lib/product-sync.ts), so a Supabase-side insert would be orphaned or
-- clobbered.
--
-- HOW TO APPLY: paste into the Supabase SQL editor (project aguorduaxfqrvvywgrdi)
-- and run once. No migration runner in this project.

alter table shipment_lines
  -- Straight off the packing list, needed to derive pieces-per-case and to
  -- join against the invoice.
  add column if not exists cartons                  integer,
  add column if not exists pieces_per_case          integer,
  -- What the Commercial Invoice said, kept verbatim for traceability.
  add column if not exists invoice_line_no          integer,
  add column if not exists invoice_description      text,
  add column if not exists invoice_unit_price_cents integer,
  -- How the invoice row was matched: cartons+pieces / pieces / family-share.
  -- Displayed to the admin rather than hidden, since a family-share match is
  -- an inference across grouped colourways.
  add column if not exists invoice_match_basis      text,
  -- The proposal the admin reviews and edits before anything is created.
  add column if not exists proposed_name            text,
  add column if not exists proposed_category        text,
  add column if not exists proposed_price_cents     integer,
  add column if not exists proposed_pieces_per_pack integer,
  -- Set once the product exists in Erply. Non-null means "do not create again".
  add column if not exists erply_created_product_id bigint,
  add column if not exists created_product_at       timestamptz,
  add column if not exists create_error             text;

create index if not exists idx_shipment_lines_unmatched
  on shipment_lines(shipment_id)
  where match_status <> 'matched';

comment on column shipment_lines.pieces_per_case is
  'Derived as qty_shipped / cartons, not read from the sheet -- this is the cs.N of the house naming standard (docs/PRODUCT-NAMING-STANDARD.md). Null when it does not divide evenly.';
comment on column shipment_lines.erply_created_product_id is
  'Set once the product has been created in Erply. Non-null blocks a second create for this line.';
