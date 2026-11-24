-- 0079: remember when a packing-list line's per-case figure counts PACKS.
--
-- Supplier Arrival Lists have no pieces-per-pack column; when one is stated
-- it's in the text ("爱心玫瑰 20张/包", "40捆（1把12支）"), and then the
-- sheet's "pk/cs" figure is packs per carton (60 packs of 20 sheets), not
-- pieces. Staging sets this so the Receiving screen can pre-fill pk/cs with
-- that figure: "20/pk 60bx/cs cs.60" rather than "20/pk 3bx/cs cs.60".
--
-- Null = not known (the common case). Existing table, so no new grants.
-- Staging writes it in a separate, error-tolerant UPDATE, so the app works
-- before and after this is applied.

alter table public.shipment_lines add column if not exists case_counts_packs boolean;

comment on column public.shipment_lines.case_counts_packs is
  'True when the packing list stated pieces per pack in its text, so its per-case figure counts packs (pk/cs). Set at staging.';
