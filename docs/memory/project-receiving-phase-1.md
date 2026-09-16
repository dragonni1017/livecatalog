---
name: project-receiving-phase-1
description: 2026-09-16 — /admin/receiving Phase 1 (stock) + Phase 2 (new products) built; 0048 applied, 0049 NOT applied; saveProduct never yet called
type: project
---

Receiving Phase 1 shipped 2026-09-16: `/admin/receiving` uploads a supplier
"Original List" workbook, stages it, lets the warehouse correct the counts,
then registers the received quantities in Erply exactly once. Scope and
reasoning live in `docs/RECEIVING-PHASE-1-SCOPE.md`; migration is
`0048_shipments_receiving.sql`.

Three live facts not derivable from the code:

1. **Migration 0048 is applied and the table layer is verified.** Applied in
   the Supabase SQL editor 2026-09-16 and exercised the same day on a
   throwaway row that was then deleted: both tables reachable (so the
   `pg_roles` grant loop worked), `numeric(10,2)` keeps a converted weight of
   22.05, a duplicate `file_hash` is rejected with 23505 (the idempotency key
   holds), both CHECK constraints reject junk values, the apply write-back
   columns round-trip, the guarded `staged -> applied` update works, and
   deleting a shipment cascade-deletes its lines. No real shipment has been
   staged through the HTTP route yet.
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
and the catalog catches up on the next sync; the UI says so explicitly. An
unmatched SKU becomes appliable the moment it's created as a product: the
create step re-resolves its line to `match_status = 'matched'`, so ONE pass
creates a container's new products and then receives every line's stock. That
flip closed a real hole — `match_status` was set once at staging and never
updated, so created products had their received pieces stranded (24 of 34 SKUs
and 67,668 of 86,484 pieces on the real EGSU9522424 container), and a
re-upload couldn't help because the unique `file_hash` reopens the same
shipment with the same stale classification. `barcode_mismatch` is excluded
from both creating and applying: that SKU already exists and only its UPC
disagrees. The rules are pure predicates in `lib/receiving.ts` so the UI and
the routes can't drift.

**Phase 2 (same day):** unmatched SKUs can become Erply products — migration 0049 (NOT applied yet), lib/commercial-invoice.ts, app/admin/api/shipments/new-products. Two things to know: the real 2026 files head the piece count 总PCS, not the English QTY the 2023 container used (the parser threw on every current file until that was fixed), and createErplyProduct/saveProduct has NEVER been called — create exactly one product and check it in Erply before trusting a batch, given the 2026-08-04 incident where a wrong saveProduct parameter zeroed 2,871 selling prices. getProductGroups IS verified live (19 groups, no nameEN field, tree-shaped with subGroups).

See [[project-packing-list-importer]] for the file-format
findings this builds on and [[project-product-measurements]] for the
inches/pounds unit trap.
