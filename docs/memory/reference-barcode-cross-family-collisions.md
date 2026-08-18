---
name: reference-barcode-cross-family-collisions
description: where the 56 cross-family barcode collisions (real product, wrong barcode) are tracked, including 3 systematic patterns; 41 found 2026-07-30, 15 more 2026-08-18
type: reference
---

56 (41 original + 15 more found 2026-08-18) of the ~104-106 duplicate-barcode groups from [[project-duplicate-barcode-families]]
are not legitimate color-family barcode sharing — they're unrelated products
carrying the same barcode by mistake. Full list and detail is in
`docs/BARCODE-CROSS-FAMILY-COLLISIONS.md`.

Three of them are systematic, not random: all 6 "DIY Pearl Beads" SKUs
(D701108–D701113) collide 1:1 with all 6 "Pull Flower Ribbon" SKUs
(F287564–F287569); 6 "Rectangular Compact Mirror" SKUs collide with unrelated
ribbon/decor-clip SKUs; and 6 pairs of genuinely-different floral paper
designs (not color variants of one paper) share barcodes. That repetition
points at one mapping error during an import, not isolated typos.

**Why:** none of this is fixable from Supabase or Erply alone — nothing in
either system says which side of a collision has the *correct* barcode.

**How to apply:** if asked about barcode data quality, point at
`docs/BARCODE-CROSS-FAMILY-COLLISIONS.md` rather than re-deriving the
collision list from the database. Don't attempt to guess/fix these without
a physical product or supplier-invoice barcode check — see
[[reference-barcode-backfill-handoff]] for the same caveat on the separate
leading-zero gap.
