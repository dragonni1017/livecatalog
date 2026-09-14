---
name: project-packing-list-importer
description: scripts/import-packing-list.mjs writes real supplier shipment measurements into products; only handles the "Original List" xls/xlsx format, not the PDF-only shipment docs
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
