---
name: project-containers-not-received-20261021
description: 2026-10-21 — of the newest 21 containers, only 7 went through /admin/receiving; 130 of their 335 SKUs are in neither the catalog nor Erply (not a sync bug); re-check with scripts/check-containers-vs-catalog.ts
type: project
---

`scripts/check-containers-vs-catalog.ts` (report only) checks the newest N
containers in the OneDrive `import documents` folder against the catalog and,
for missing SKUs, against Erply.

**First run, 2026-10-21, newest 21 containers (ETD 08-14 to 09-27):** 335
distinct SKUs — 74 live, 131 hidden, 130 not in the catalog. **All 130 are
missing from Erply too**, so the nightly sync has nothing to insert (its
runs show 0 inserts, 0 errors, correctly). The newest product in Erply was
T642260, created 2026-10-06; containers kept arriving after that.

Only 7 of the 21 have a `shipments` row (the ones applied 2026-09-23 plus
EGSU9509206). The other 14 were never staged, which is the whole gap: biggest
are EGSU9777282 (32 missing: K229561–K229578, 4531-8..11, ...), EGSU1118334
(26: G333213–G333236), EGHU9765009 (14).

**How to apply:**
- "In the container but not in the catalog" is a receiving backlog, not a
  sync bug — unless the script's "In Erply, not catalog" column is non-zero,
  which IS the sync failing (cf. the products_id_seq collision in
  [[project-receiving-to-catalog-20260923]]).
- Several missing SKUs ship on 2-3 containers (CM072601 + H424272 on three;
  CM072322 on three; F288023 x4 colours on two). Create them from the first
  container staged, then stage the others — a line staged before its product
  exists stays `unmatched_sku` (see [[project-containers-20260917]]).
- TLLU5419845 heads its SKU column `item`, not 货号; the parser accepts that
  since PR #148. The two ETD 0131 (2026-02) lists still fail on their
  piece-count header.
