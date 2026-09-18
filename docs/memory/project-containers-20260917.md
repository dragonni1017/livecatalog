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
- **S121037's carton figures are impossible**: 3.35in cube at 41.89 lb for 72
  pieces. It's the only line on any of the three sheets with carton
  dimensions at all (91 of 92 are blank), so nothing depends on it — same
  class of bad upstream value as the 28 noted in
  [[project-product-measurements]].

**How to apply:** 68 of the 92 SKUs are new, so most of these pieces can't be
received until Phase 2 creates the products — that needs the matching
**Commercial Invoice** for each container, which was not in the Downloads
folder with the arrival lists. Pricing stays a manual Erply step either way.
Receiving on top of the fake 1000 stock is fine — see
[[project-fake-stock-1000-hold]]. Parser/flow background in
[[project-receiving-phase-1]].
