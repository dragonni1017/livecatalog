---
name: project-duplicate-barcode-families
description: 104-106 barcode groups share a barcode across multiple SKUs; F286606 confirmed+deactivated everywhere 2026-08-18; 6 more likely-duplicate candidates found 2026-08-18 but on hold (price mismatch); ~15 more cross-family collisions found, not yet merged into the 41-item collision doc
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

**Same-barcode/different-category groups within the 143 deactivate candidates
(reviewed 2026-07-30, no action taken):** cross-checking barcodes within
`data/erply-review/deactivate-candidates.csv` (TODO #6, see
[[project-erply-woo-proactivity-setup]]) surfaced 7 groups sharing a barcode
across SKUs with inconsistent `category` values — the same shape of signal
that caught the real F286606 bug above: `F286366` (`-P`/`-W` vs `-WH`),
`F286388` (`-Clear`/`-PK`/`-PUR` vs `-R`), `F286431` (`-PK` vs `-RD`),
`F286587` (`-PK`/`-R` vs `-RG`), `F286591` (`-Clear`/`-PK` vs `-Rd`),
`F287062` (`-A` vs `-D`), and `F287279` (`F287279`/`-Pp`/`-R`/`F287279R` —
this last group also has `F287279-R`/`F287279R` differing only by a hyphen,
the strongest signal of the set). **User reviewed and decided these are
fine as legitimate variations — do not treat category mismatch alone as a
duplicate-listing signal for this catalog, and do not re-flag these 7
groups without new information.** Unlike F286606, this was a judgment call
without independently confirming against Erply's real code per-row — if the
`F287279` group later causes a real problem (e.g. two genuinely different
listed prices customers can pick between for what should be one SKU), it's
worth revisiting specifically, since it's the one with the hyphen-only
code collision on top of the category mismatch.

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

**2026-08-18: reviewed all remaining ~56 never-individually-checked
duplicate-barcode groups** (the ones not already covered by
[[reference-barcode-cross-family-collisions]]'s 41, the 7 reviewed-fine
groups above, or F286573) by checking each SKU's exact code against Erply's
live `code` field, the same method that confirmed F286606. **First-pass
result was mostly false positives** — a crude "some rows match Erply, some
don't" filter flags the expected/legitimate "one barcode covers a whole
color family, only one variant tracked in Erply" pattern just as often as a
real bug, so don't reuse that filter alone. Manually reading all 56 for the
real F286606 signature (two rows describing the *same specific variant*, not
different colors) found two genuinely new buckets:

1. **~15 new cross-family collisions** (unrelated products sharing a
   barcode by data error, e.g. `3D801227` Lobster vs `3D801227-STARFISH`,
   `T641647` Umbrella vs `T641647-1` Water Jug, `P273581` Graduation Bear
   Plush vs `P273581-1` Bear Keychain) — same class as
   [[reference-barcode-cross-family-collisions]]'s existing 41, needs the
   same physical/supplier check, not data-fixable. Not yet added to
   `docs/BARCODE-CROSS-FAMILY-COLLISIONS.md` — do that before acting on any
   of them.
2. **6 likely-genuine near-duplicate-listing candidates**, same shape as
   F286606 (one Erply-matching row, one stale non-matching row, matching
   name/barcode/category): `D751067`/`D751067-Pink` (3D Pink Backpack),
   `H424249`/`H424249-1` (Bunny Headband w/ Lights), `T641545`/`T641545-1`
   (Cow Bounce Toy), `D751052`/`D751052-3D Egg` (mystery egg), `T642023`/
   `T642023-YELLOW` (Diamond Cup, sport-name typo), `F286162-1
   PANDA`/`F286162-Panda` (Panda Rose Bear). All 6 non-matching rows have
   `updated_at` stuck at `2026-06-19` (never touched by the 2026-08-06
   quarter-rounding price update) vs `2026-08-06` on the matching rows —
   same staleness signal as F286606/F286573.

   **But unlike F286606, every one of these 6 pairs has a price
   discrepancy between the two rows** (e.g. `H424249` $0.50 vs `H424249-1`
   $1.00) — same blocking condition as F286573 above. **User decision
   2026-08-18: hold off on all 6, same reasoning as F286573** — don't
   deactivate any of them until the price discrepancy is checked against a
   supplier invoice or QuickBooks. Do not re-propose deactivating these
   without new price-resolution information.
