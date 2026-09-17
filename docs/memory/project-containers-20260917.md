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

- **K229480's stored barcode is truncated**: Supabase has 11 digits
  (`73787910121`), the sheet has the full 12 (`737879101216`), and its
  neighbour K229479 is `737879101209` — same series, so the sheet is almost
  certainly right and the DB lost the check digit.
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
