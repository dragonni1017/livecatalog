---
name: project-bin-capacity-type-grouping
description: 518 Erply bins seeded and grouped into 5 bin_types by shelf level; dimensions still unmeasured, 57 bins unresolved
type: project
---

Migration 0046's grant fix was applied 2026-09-14, then
`scripts/seed-bins-from-erply.mjs --apply` mirrored all 518 Erply bins into
Supabase (518 inserted). All had `bin_type_id = null` (unknown capacity).

`scripts/assign-bin-types-by-level.mjs --apply` then grouped the 461
standard `AA-RR-L` coded bins into 5 new `bin_types` — "Level 1 (floor)"
through "Level 5" (141/141/139/22/18 bins respectively, matching
`analyze-warehouse-map.mjs`'s rack-level counts exactly). **Every one of
these 5 types still has null length_in/width_in/height_in/max_weight_lb** —
the script only recorded which bins share a shape, not how big it is.
Capacity is unusable (`binTypeIsUsable` false) until a human measures each
level and enters real numbers via `/admin/bins`.

57 bins were deliberately left with no type: `receiving_area`,
`shipping_area`, and 55 four-digit combined-aisle floor codes (e.g.
`0102-01-1`, spanning two aisles). These are physically different fixtures
from a single-aisle rack shelf, not just another "Level 1" — lumping them in
would have been a guess, not a read of the code. They need a human decision
on how many distinct shapes they actually are.

**Why:** actual bin dimensions are physical facts only a human with a tape
measure (or existing rack spec sheets) can supply — this project has
repeatedly been burned by fabricated/guessed physical measurements (see
[[project-product-measurements]]). Grouping by level is a safe read of the
existing code structure; guessing inches or pounds is not.

**How to apply:** before trusting any bin capacity number, check the 5
`bin_types` have real dimensions filled in via `/admin/bins`. Before running
`assign-bin-types-by-level.mjs` again, note it's idempotent (skips bins that
already have a type) — safe to re-run after a fresh Erply seed picks up new
bins. The 57 non-grid bins are still unassigned; resolving them needs
someone who knows the physical receiving/shipping area layout.
