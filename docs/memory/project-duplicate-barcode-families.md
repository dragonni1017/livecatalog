---
name: project-duplicate-barcode-families
description: 106 barcode groups (252 rows) share a barcode across multiple SKUs; F286606 confirmed as true duplicate listings and deactivated 2026-07-30, rest need manual review
type: project
---

Found by cross-checking Supabase `products.barcode` against Erply `code2` for
[[project-erply-pagination-fix]]. 106 distinct barcodes are shared by more
than one SKU (252 rows total) — full list exported to
`duplicate-barcode-families.csv` (not checked into the repo, was a one-off
deliverable) with `is_active` and whether each SKU's exact code exists in
Erply.

Most of these look like **intentional** manufacturer behavior: one UPC
covers a whole style, reused across color/size children (e.g. barcode
`681402387984` legitimately covers `F286388-Blue/-Clear/-PK/-PUR/-R`, five
colors of one dome).

But the `F286606` family (white/pink/black butterfly wrapping paper) was a
**real duplicate-listing bug**: 8 active Supabase rows for what should be 4
colors — each of white/pink/black existed twice, once under an older
naming/casing ("...Wrapping Paper", e.g. `F286606-Wt`) and once matching
Erply's actual code exactly ("...Floral Paper w/ Gold Butterfly", e.g.
`F286606-WT`), both with identical barcodes. Fixed 2026-07-30: deactivated
the non-Erply-matching row per color (`F286606-Wt`, `F286606-Pk`,
`F286606-BLK` → `is_active=false`), kept the Erply-matching casing live
(`F286606-WT`, `F286606-PK`, `F286606-Blk` — note Erply's real code for
black is mixed-case `Blk`, not `BLK`, so the casing that "wins" isn't
consistent across colors — checked each one against Erply's actual `code`
field individually, don't assume a pattern). Logged in `audit_log`
(entity_id `prod-01701`/`prod-01703`/`prod-01707`).

Also found: `F287638` ("Green Santa Claus Floral Wrapping Paper") shares a
barcode with the black F286606 wrapping paper — that doesn't fit the
"one barcode per color family" pattern (different product entirely, not a
color variant) and looks like a genuine data-entry error. Not fixed — needs
the correct barcode sourced before touching it.

**Why:** discovered while double-checking the SKU/barcode match rate between
Supabase and Erply as part of readying the Erply integration
([[project-erply-image-backfill]]) — 9 of the SKUs that match by code
disagreed on barcode value, and 6 of those 9 turned out to be this
duplicate-row issue rather than a simple data disagreement.

**How to apply:** before trusting `products.barcode` for anything
barcode-scanner-facing, review the remaining ~103 duplicate-barcode groups in
the CSV — most are probably fine (shared style barcode), but don't assume
that without checking, the way F286606 turned out not to be fine. See also
[[reference-barcode-backfill-handoff]] for the separate leading-zero gap,
which is a different class of barcode problem.

**F286573-LPK vs F286573-PK (checked 2026-07-30, NOT fixed yet):** confirmed
against live Erply data that `F286573-LPK` is Erply's real, active code;
`F286573-PK` doesn't exist in Erply at all (any casing). Same name/barcode/
category/`updated_at` as the F286606 pattern, so `-PK` looks like the same
class of stale duplicate row — except the two rows have *different prices*
($6.00 on `-LPK` vs $8.00 on `-PK`), so this isn't a clean duplicate like
F286606 was. User decided to **hold off** rather than deactivate `-PK`
outright — needs the price discrepancy checked against a supplier invoice or
QuickBooks before touching either row. Do not deactivate `-PK` or edit
`-LPK`'s price until that's resolved.
