---
name: project-bin-capacity-type-grouping
description: all 518 Erply bins grouped into 8 bin_types (5 by level + 3 special); every type still has null dimensions, blocked on a physical measurement pass
type: project
---

Migration 0046's grant fix was applied 2026-09-14, then
`scripts/seed-bins-from-erply.mjs --apply` mirrored all 518 Erply bins into
Supabase (518 inserted). All had `bin_type_id = null` (unknown capacity).

`scripts/assign-bin-types-by-level.mjs --apply` then grouped the 461
standard `AA-RR-L` coded bins into 5 new `bin_types` — "Level 1 (floor)"
through "Level 5" (141/141/139/22/18 bins, matching
`analyze-warehouse-map.mjs`'s rack-level counts exactly).

`scripts/assign-remaining-bin-types.mjs --apply` then covered the other 57:
`receiving_area` and `shipping_area` each got their own type, and the 55
four-digit combined-aisle floor codes (e.g. `0102-01-1`, spanning two
aisles) were lumped into one shared "Combined-aisle floor" type — nothing in
the data distinguishes their shape from each other, so splitting them
further would have been a guess. **All 518 bins now have a bin_type_id**
(8 types total).

**Every one of the 8 types still has null length_in/width_in/height_in/
max_weight_lb.** Both scripts only recorded which bins share a shape, not
how big it is — capacity is unusable (`binTypeIsUsable` false) for all 518
bins until a human measures each of the 8 types and enters real numbers via
`/admin/bins`. Checked 2026-09-14: no vendor invoice, rack spec sheet, or
any dimension data exists anywhere in this repo or its data files (the
warehouse map xlsx has layout/codes only, never dimensions) — a physical
tape-measure pass is the only way to unblock this, and as of this session
the user doesn't have warehouse access to do it yet.

**Why:** actual bin dimensions are physical facts only a human with a tape
measure (or existing rack spec sheets) can supply — this project has
repeatedly been burned by fabricated/guessed physical measurements (see
[[project-product-measurements]], which has the same blocker: 986 of 3,222
product cartons still need physical measuring too).

**How to apply:** before trusting any bin capacity number, check the 8
`bin_types` have real dimensions filled in via `/admin/bins`. Both
assignment scripts are idempotent (skip bins that already have a type) —
safe to re-run after a fresh Erply seed picks up new bins. If the combined-
aisle floor bins turn out to differ physically, split them by hand in
`/admin/bins` rather than re-running the script.
