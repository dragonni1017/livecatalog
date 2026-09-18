---
name: project-containers-20260917
description: 2026-09-17 — three arrival lists (EMCU8323054/EGSU8096690/EGSU1396926) dry-run through receiving; found+fixed two staging bugs; 68 of 92 SKUs are new, K229582 spans two containers
type: project
---

Three containers landed 2026-09-17 (ETA 09-17-2026, all ETD 0904). Their
Arrival Lists were parsed and classified through the real receiving code
**parse-only — nothing staged, nothing applied, no Erply call.**

| Container | sheet | SKUs | pieces | matched | new | barcode_mismatch |
|---|---|---|---|---|---|---|
| EMCU8323054 | 实装 | 37 | 117,440 | 9 | 26 | 2 |
| EGSU8096690 | Sheet1 | 40 | 48,456 | 6 | 34 | 0 |
| EGSU1396926 | 实装 | 15 | 66,036 | 7 | 8 | 0 |

Zero parse rejections on all three; `总PCS` format throughout, cm/kg headers.

**Two real staging bugs, found by these files and fixed the same day:**

1. `normalizeBarcode` only trimmed *surrounding* whitespace, so EGSU1396926's
   `6  8140239892 8` read as a different barcode from the stored
   `681402398928` and T641449 (6,000 pieces) was excluded from apply. Now
   strips every non-digit. Regression test in `tests/packing-list.test.ts`.
2. The staging route looked the catalog up with `.in('sku', …)` — Postgres is
   case-sensitive, so EMCU8323054's lower-case `p273762` never matched the
   existing `P273762`, stranding 4,800 pieces *and* queueing a duplicate
   product for creation. The surrounding map was already upper-cased, so the
   intent was there and only the query was wrong. Now queries both casings.

**Data problems these files exposed (not fixed — need a human call):**

- **K229480's short barcode — "fixed" 2026-09-17, REVERTED 2026-09-18. Do not
  redo this.** Both systems held 11 digits (`73787910121`) against the arrival
  list's `737879101216`, and that was rewritten in Erply and Supabase on the
  theory that a UPC-A had lost its check digit. **The theory was wrong.**
  Barcode length varies legitimately on this account depending on when the
  product was set up (Dragon, 2026-09-18) — 11 digits is not evidence of
  truncation. The supporting arguments were both hollow: a check digit that
  "validates" proves nothing, because appending the correct check digit to
  *any* 11 digits yields a valid UPC-A, and a neighbouring SKU sharing a
  prefix is not a second source. Restored verbatim in Erply then Supabase, 0
  other fields drifted; both one-shot scripts deleted.
  A paginated census (11 short barcodes, not the 4 first reported — that
  count came from an unpaginated query silently capped at PostgREST's 1000
  rows) shows the shape: `11:11, 12:2929, 13:3, 14:1` across 2,944 barcoded
  products. The 11 under-12s are F286653-WT, K01873, K01881, K01885, K02203,
  K02311, K02561, K02565, K229480, L61981, T642055 — i.e. a whole `91671…`
  cohort *and* several `73787…`, which is exactly what an era-of-setup
  difference looks like rather than a set of individual typos.
- **K229479 is a genuine mismatch**, correctly flagged: sheet says
  `0034635763`, catalog says `737879101209` — a different UPC series
  entirely, not a formatting difference.
- **K229582 ships on two of the three containers** (2,160 on EMCU8323054,
  2,640 on EGSU8096690) and is new in both. Create it from whichever
  container is staged first; the second shipment's line will still say
  `unmatched_sku` and *cannot* be re-staged to pick up the new product,
  because the unique `file_hash` reopens it with its stale classification.
  Either stage the second container after the create, or its 2,640 pieces
  strand.
- ~~S121037's carton figures are impossible~~ — **our bug, not the
  supplier's. Fixed 2026-09-18.** The "3.35in cube at 41.89 lb" and the 91 of
  92 blank cartons had the same cause: `lengthDim: ['长']` matched the first
  header containing 长, which on the 2026 format is the *product*-spec column
  `产品规格尺寸长*宽*高（CM）` sitting left of the real `长cm(外箱)`. One cell
  contains 长, 宽, 高 and "CM", so all three axes collapsed onto it — text
  cells like `"57*57CM"` nulled the carton silently, numeric ones produced an
  L=W=H cube. Both copies now prefer the column marked `外箱` (outer carton)
  and throw rather than choose between unmarked candidates. After the fix all
  92 lines carry real cartons, 0 cubes; S121037 reads 25 x 12.6 x 9.84 in at
  41.89 lb. Do NOT record this as bad supplier data — see
  [[project-product-measurements]] for the 28 that genuinely are.

**Commercial Invoices found 2026-09-18** in the OneDrive `import documents`
folder (not Downloads), one per container alongside an Original List and a
Packing List. All three parse and reconcile *exactly* — invoice cartons equal
the `NNNctn` in the filename and invoice pieces equal the packing list's
total, on all three. Arrival List and Original List are byte-for-byte
equivalent for parsing purposes; either works.

Auto-naming covers **34 of the 68 new SKUs** (28 priced), and the shortfall is
structural rather than a defect: **the invoice describes goods by customs
category, so one row covers many SKUs** — EGSU8096690's single "Garland
Ribbons 4cm" row (247ctn/8,600pcs) spans all 20 unmatched `FD400*-25YARD` /
`FD500*` ribbons, and EMCU8323054 has 20 invoice rows for 37 SKUs. The join
refuses to split an aggregate row, which is correct; those SKUs need a name
typed by hand. EGSU1396926 is the clean case at 8/8 named. The Original List
also carries a 品名 column the parser ignores (F288116's is `金边/香槟金`,
"gold trim / champagne gold") — that is exactly what distinguishes invoice
lines 1-4 from each other, so it's the obvious input if auto-naming is ever
pushed further.

**How to apply:** 68 of the 92 SKUs are new, so most of these pieces can't be
received until Phase 2 creates the products. Pricing stays a manual Erply step
either way.
Receiving on top of the fake 1000 stock is fine — see
[[project-fake-stock-1000-hold]]. Parser/flow background in
[[project-receiving-phase-1]].

**Open, blocked on a permission prompt (2026-09-18):** a shipment for
EMCU8323054 is already staged (`a6b93a58-090e-4e3c-8b19-3968f5ac96ed`, staged
2026-09-17 20:25 UTC) and carries the **pre-fix classification** — it froze
`p273762` as `unmatched_sku`, so creating products from it would duplicate the
existing `P273762` and strand 4,800 pieces. Nothing is applied and nothing
created, so it is safe to delete, but a re-upload cannot fix it: the unique
`file_hash` reopens the same rows, and `abandoned` does not release the file
either, because the POST lookup doesn't filter on status. **There is no DELETE
route** — `app/admin/api/shipments/route.ts` has GET/POST/PATCH only, so
removing a stale shipment needs SQL:
`delete from shipments where id = 'a6b93a58-090e-4e3c-8b19-3968f5ac96ed';`
(lines cascade). **RESOLVED 2026-09-18:** the stale shipment was deleted, and
`app/admin/api/shipments` now has a guarded `DELETE ?shipment_id=`, so this no
longer needs the SQL editor. The guard is `blockersForDelete` in
`lib/receiving.ts`, next to the apply/create predicates so the UI and the
route can't drift. It blocks on ANY irreversible work — an applied status, any
`applied_at`, any `erply_created_product_id` — because those rows are the only
record that a one-way Erply add happened: deleting them would hide the receipt
rather than reverse it, and would let the same file be staged and applied a
second time. Verified live against a throwaway row: a delete guarded on a
stale status returns 0 rows without erroring (so the route 409s rather than
silently reporting success), the matching status returns 1, lines cascade with
no orphans, and the freed `file_hash` re-stages. The "Previous shipments"
table on `/admin/receiving` calls it, running the same predicate client-side
to decide whether to offer the button — the history rows don't carry their
lines, so it sees status alone for every row but the one currently open, and
the server is what actually refuses. A blocked row reads "kept as a receipt"
with the reasons in its title. Note this is distinct from **abandon**, which
sets `status='abandoned'` but leaves the row holding the `file_hash`, so a
re-upload reopens the abandoned shipment with its stale classification —
abandon is not a way to re-stage a file.
