---
name: project-receiving-phase-1
description: 2026-09-16 — /admin/receiving (packing list → Erply stock) built; migration 0048 NOT YET APPLIED, and apply needs Erply creds which Vercel production lacks
type: project
---

Receiving Phase 1 shipped 2026-09-16: `/admin/receiving` uploads a supplier
"Original List" workbook, stages it, lets the warehouse correct the counts,
then registers the received quantities in Erply exactly once. Scope and
reasoning live in `docs/RECEIVING-PHASE-1-SCOPE.md`; migration is
`0048_shipments_receiving.sql`.

Three live facts not derivable from the code:

1. **Migration 0048 is not applied.** Confirmed 2026-09-16: both tables return
   PGRST205 "Could not find the table 'public.shipments' in the schema cache".
   The screen and dashboard tile degrade quietly to empty until it runs (they
   null-coalesce), so a blank Receiving page is the expected pre-migration
   state, not a bug.
2. **Apply can't run where Erply isn't configured.** Erply credentials exist
   locally but not in Vercel production. The apply route returns a 503 saying
   so rather than calling the stub path in `lib/erply.ts`, which would make a
   no-op look like a success. Either add `ERPLY_*` to Vercel or receive from a
   local run.
3. **The parser port is verified against the real container.** `lib/packing-list.ts`
   is now the canonical copy of the parsing rules, tested in
   `tests/packing-list.test.ts` against the actual EMCU8402359 workbook in
   OneDrive — 27 line items, zero rejections, matching what
   `scripts/import-packing-list.mjs` found on 2026-09-14. That test skips
   itself when the OneDrive folder isn't mounted. One deliberate divergence
   from the .mjs mirror: the lib finds dimension columns by name alone and
   then *requires* a unit in the header, so an inch-labelled sheet errors
   loudly instead of silently producing null cartons.

**Why:** receiving was a pair of scripts you had to remember not to run twice,
against an API that only does deltas — `saveInventoryRegistration` adds, so a
second run doubles the stock. EMCU8402359 is the standing proof of the other
half of the danger: it parses perfectly but shipped in 2023, and applying it
would inject phantom stock for inventory already sold.

**How to apply:** never write `products.stock_qty` from receiving — it's
excluded from the Erply→Supabase sync on purpose (0042's anchored delta) and a
direct write would fight the order-fulfillment decrement. Stock lands in Erply
and the catalog catches up on the next sync; the UI says so explicitly. New
products from packing lists are still out of scope (Phase 2) — the sheets
carry no English name, category, or price, which is why unmatched SKUs stage
but never apply. See [[project-packing-list-importer]] for the file-format
findings this builds on and [[project-product-measurements]] for the
inches/pounds unit trap.
