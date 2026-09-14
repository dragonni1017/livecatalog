---
name: project-packing-list-importer
description: import-packing-list.mjs (dimensions) + add-stock-from-packing-list.mjs (Erply stock) both read the same "Original List" xls/xlsx shipment file; stock script must NOT be run on already-received/old shipments
type: project
---

The OneDrive `import documents` folder (`C:\Users\Dragon\OneDrive - L&Y USA\L&Y\L&Y\import documents`)
is almost entirely PDFs (arrival notices, bills of lading, duty paperwork) —
not usable as structured input. The exception: files with **"Original
List"** in the name are real `.xls`/`.xlsx` spreadsheets from the supplier,
with a `货号` column that IS the Erply/Supabase SKU verbatim (format
`F######`) and a UPC column matching `products.barcode` exactly. Confirmed
live 2026-09-14 against container EMCU8402359 ("Round") — all 27 line items
matched with zero rejections.

`scripts/import-packing-list.mjs` reads one such file (`--file=<path>`,
dry-run by default, `--apply` to write) and updates `products.case_*_in` /
`case_weight_lb`. Columns are matched by header text, not position.
**Units are read from the header text itself** (e.g. `长cm(外箱)` → cm,
`毛重KG（每包装箱）` → kg) rather than assumed — a header with no recognizable
unit is a hard error. The UPC column is cross-checked against
`products.barcode` per matched SKU; a mismatch rejects the row instead of
writing it, since this business has real barcode-collision history (see
[[project-duplicate-barcode-families]]).

Writes use `measurements_source='manual'` (the only schema value with
"never overwritten by the Erply/Woo backfill" precedence — see migration
0045's check constraint, only `erply`/`woo`/`manual` are allowed) with
`measurements_updated_by` set to `packing-list:<filename>` for traceability,
rather than adding a new enum value via migration.

**Why:** Erply's own carton dimensions are unstable (documented in
[[project-product-measurements]]), while a supplier's packing list is a real
physical measurement taken at packing time — worth trusting over Erply, but
only when the SKU match is verified (hence the UPC cross-check) and the unit
is explicit (hence reading it from the header, never guessing cm/kg like the
hand-filled worklist has to).

**How to apply:** only files named `*Original List*.xls`/`.xlsx` in that
OneDrive folder are known to work — the "Original Packing List" PDFs and
"Arrival List" PDFs seen in the same folder have no SKU column and were
NOT validated by this script. If a new supplier's file has a different
header layout/language, `findCol`/`dimensionFactor`/`weightFactor` in the
script will hard-error rather than silently misreading it — that's
intentional, fix the mapping rather than loosening the match. The plausibility
check here is a fourth mirror of `lib/measurements.ts`'s
`implausibleCaseMeasurement` — see that file's comment before changing the
bounds anywhere.

## Stock additions (add-stock-from-packing-list.mjs)

Same file also has a `QTY` column (pieces per line, already totalled by the
supplier) usable to add received stock — but stock has to be written to
**Erply, not Supabase**: Erply only has delta APIs
(`saveInventoryRegistration`), and `products.stock_qty` is deliberately
excluded from the normal Erply→Supabase sync (it gets decremented on order
fulfillment — see [[project-order-fulfillment-stock-decrement]]), so writing
it directly would fight that and get overwritten by the next sync anyway.

`scripts/add-stock-from-packing-list.mjs` mirrors the older, hardcoded
`add-stock-from-arrival-lists.mjs`: exact SKU match against Erply only, no
barcode fallback (a SKU with no exact match is reported, not written — could
be a genuinely-new product needing `saveProduct` with an English name +
category, which no packing list supplies, or a barcode-only near-match that
needs a human look). Dry run writes a backup CSV to
`data/erply-bulk-import/` before any write; `--apply` batches
`saveInventoryRegistration` calls (50/batch) and independently re-fetches
stock afterward to confirm.

**Tested against container EMCU8402359 (2023-11) — all 27 SKUs matched
correctly — but deliberately NOT applied for real**, because every SKU
already shows 0 current stock: this shipment is ~3 years old and that
inventory has clearly already been received and sold through. Only run
`--apply` on this script for a shipment that hasn't been received/counted
yet; running it against an old container would inject stale phantom stock
into live inventory. The dimensions importer has no such restriction —
carton size doesn't go stale, so it's safe to run against any shipment file
regardless of age.

New-SKU handling was deliberately left as report-only per Dragon's choice
2026-09-14 — no auto-creation of products from packing-list data, since the
required English name + category aren't present in these sheets.
