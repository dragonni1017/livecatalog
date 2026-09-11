---
name: project-product-measurements
description: 2026-09-11 product dims/weight for bin capacity — data is INCHES/POUNDS despite Woo declaring kg/cm; Erply bins have no dimension or weight-limit fields at all
type: project
---

Products gained physical measurements (migration `0045`) so warehouse bin
capacity can be planned. Four things a future session should not re-derive:

**1. The upstream data is inches and pounds, and WooCommerce mislabels it.**
Woo's store settings declare `kg / cm`. The values are imperial. Erply's own
configured unit list is `pcs, lb, in, ft, sq ft, cu ft`, and the numbers only
make physical sense read that way — an 18" plush 6-pack is `23.6 x 18 x 20`
at `33.5`; as cm+kg that's 33.5 kg in an 8.5-litre box, three times the
density of concrete. Columns are named `case_weight_lb` / `case_length_in` so
the unit can't be lost again. **A naive trust of Woo's settings introduces a
2.2x / 2.54x error.**

**2. The figures are master-carton, not per-piece.** Every measured product
in Erply is named "N/pk" and the value is the case ("3D Printed Turtle
Keychain - 12/pk 5bx/cs" at 29 lb is a case). Erply has exactly one dimension
triple + `netWeight` per product and its native packaging fields
(`productPackages`, `containerID`, `soldInPackages`) are unused on all 3,076
active products — so **Erply physically cannot hold both a case and a unit
measurement.** That's why `0045` has separate `case_*` and `unit_*` sets and
Supabase, not Erply, is the system of record. `unit_*` is hand-entry only.

**3. Erply and Woo agree exactly, so either is a valid source.** Of 3,160
fields where both had data, **zero** differed by more than 2%. No
reconciliation problem exists; the backfill prefers Erply per-field and falls
back to Woo.

**4. Erply bins have no capacity fields whatsoever.** `getBins` returns 518
bins (517 active, all warehouse 1, `aisle-rack-level` codes, `allowedProduct=1`
meaning one product per bin) and the record exposes only `binID`,
`warehouseID`, `code`, `status`, `preferred`, `order`, `allowedProduct`,
`replenishmentMinimum`, `maximumAmount`. **No dimensions, no weight limit** —
`maximumAmount` (a bare quantity) is the only capacity concept and is 0 on all
518. `getBinRecords`/`getBinQuantities` return zero rows, so no product is
assigned to a bin yet. `getLocations`, `getWarehouseLocations`,
`getStorageLocations`, `getProductsInBins` all error 1005 (unsupported).

**5. Some upstream values pass a `> 0` check but cannot describe a carton.**
26 products carry a dimension of exactly `0.2` (all floral/wrapping paper) —
one repeated placeholder, not 26 measurements — and 5 imply a density above
lead, e.g. `D751087` "Large 3D Printed Gear Ball" at 94.8 lb in 1.2 x 2 x 17
in = 2.3 lb/in³. 28 products in total. The worklist routes these to an
"Implausible - Recheck" sheet and does **not** count them as measured.

The same `implausible()` test lives in both
`build-measurement-worklist.mjs` and `import-measurement-worklist.mjs` and
**must stay identical** — if they drift, one script flags a carton the other
accepts back. Bounds come from the real distribution of 2,244 backfilled
cartons: weight p50 30.9 / p99 64 / max 189.6 lb, dimensions p50 18 / p99 49
/ max 188 in. Hence reject at >250 lb and >120 in, which costs no real data.

**A sheet filled in in centimetres/kilograms is NOT detectable, and nothing
pretends to detect it.** cm+kg entry lands near 0.0002 lb/in³, while genuine
bulky-light products (artificial flowers, ribbon, wreaths) run from 0.00002
up with p1 at 0.00014 — the ranges overlap, so any density floor that caught
a metric sheet would reject dozens of real cartons. The defences are the
template's "(in)"/"(lb)" column headers only. Grams *are* caught, by the
weight ceiling.

**6. The upstream data is not stable between runs.** Erply reported
dimensions for ~200 products at 20:29 on 2026-09-11 and `length="0"` for
those same products 20 minutes later; the SKU sets are stable (3,076 Erply /
3,229 Woo across repeated fetches, no duplicate codes), only the field values
move. The backfill only ever fills values in and never nulls them out, so
captured measurements survive their source losing them — which is why
Supabase and not Erply is the system of record.

**7. Per-piece (unit_*) measurements are out of scope.** Decided 2026-09-11:
bins hold sealed cases, so carton figures are the whole job. The `unit_*`
columns stay in the schema as headroom but nothing fills them, and the
worklist's old "Need Unit Measurement" sheet was dropped because it listed
2,209 products nobody intends to measure.

**8. A batched upsert cannot be used to update these columns.** An id-only
`upsert(..., { onConflict: 'id' })` payload fails `null value in column
"sku"` — Postgres validates NOT NULL when the proposed tuple is formed,
before `ON CONFLICT` resolution runs, so it never reaches the `DO UPDATE`.
Padding the payload with sku/name/price to satisfy that would let a backfill
script *insert* products. Both scripts therefore do per-row `update().eq('id',
…)`, 8 in flight. (`lib/product-sync.ts` gets away with `onConflict: 'sku'`
because its payload includes `sku`.)

State after the backfill ran on 2026-09-11 (2,352 rows written, per-row
UPDATE, 0 failures), of 3,222 active products: **2,208 with plausible full
carton measurements, 28 implausible, 986 still need measuring** (395 visible,
591 hidden).

The round trip is verified end to end: the importer's write path, the
`measurements_source='manual'` flag, and the backfill honouring it (reporting
`skipped (hand-measured)`) were all exercised live on 2 products on
2026-09-11 and then reverted to null, so no invented measurement is in the
table.

**Why:** the goal is to know how much of a SKU fits in a given bin, by volume
and by weight limit. That needs product measurements (this node) *and* bin
measurements, and the bin half has nowhere to live in Erply.

**How to apply:** never add a bare `weight`/`length` column or convert units
without re-reading point 1, and never treat a `> 0` upstream measurement as
usable without the plausibility test in point 5. Re-check coverage with
`scripts/check-dimension-weight-coverage.mjs` (read-only) rather than trusting
the counts above. Backfill with
`scripts/backfill-product-measurements.mjs --apply` — it skips rows marked
`measurements_source='manual'` so warehouse hand-measurements are never
overwritten. `scripts/build-measurement-worklist.mjs` produces the fill-in
xlsx for the gap and `scripts/import-measurement-worklist.mjs
[--file=…] [--by=email] --apply` reads it back as `manual`. If bin capacity gets built, the bin dimensions and
weight limits have to be stored in this repo; only `maximumAmount` can be
pushed back to Erply. See also [[project-erply-pagination-fix]] for the
getProducts page cap and [[project-erply-duplicate-customer-incident]] for why
any Erply *write* gets its own script and dry run.
