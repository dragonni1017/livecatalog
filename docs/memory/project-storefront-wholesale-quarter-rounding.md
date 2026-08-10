---
name: project-storefront-wholesale-quarter-rounding
description: 2026-08-06 -- livecatalog storefront price formula changed from retail+20% markup to actual Wholesale-tier (50% off retail) price, quarter-rounded skipping .75; applied live to all 2,868 matched products
type: project
---

**Decision (2026-08-06):** Dragon asked to change the livecatalog (public,
Vercel-hosted) storefront pricing to "wholesale," and to round all prices
to the nearest quarter, skipping `.75` (a price lands on `x.00`/`x.25`/
`x.50`, or rounds up to the next whole dollar — never `x.75`).

**What changed, in `lib/erply.ts` (source of truth for both the live
`app/api/sync/route.ts` full-sync path and the narrower
`scripts/sync-prices-only.mjs`):**
- `WHOLESALE_MARKUP = 1.2` (retail-anchor price × 1.2, i.e. *above* retail —
  a stale formula from before [[project-retail-anchor-pricing-flip]], since
  it predates Erply's `price` field becoming the retail anchor) replaced
  with `WHOLESALE_DISCOUNT = 0.5`, matching Erply's actual live Wholesale
  price list discount (confirmed 50% in that same doc).
- New `roundToQuarterSkip75()` helper applied to the result: nearest of
  `{x.00, x.25, x.50, (x+1).00}` — `.75` is never a landing point.
- `scripts/sync-prices-only.mjs` has an identical, manually-mirrored copy of
  both the discount constant and the rounding function (same pattern as
  `lib/tier-mapping.ts` / `scripts/assign-woo-tier-roles.mjs` — .mjs scripts
  can't import from `lib/`, so keep both in sync by hand if either changes).

**Applied live 2026-08-06** via `sync-prices-only.mjs --apply`: 2,868 of
2,870 active-matched Supabase products updated (2 were already correct).
Example: SKU 82036 went from $10.08 (old retail×1.2 markup, higher than
retail) to $4.25 (actual wholesale, quarter-rounded). Re-verified live
afterward (not trusting the writer's own log): re-running the dry run shows
0 remaining diffs across all 2,870 matched SKUs.

**Why:** the old `retail × 1.2` formula predated the Aug-4 retail-anchor
flip and was never updated afterward, so it had drifted into showing a
price *above* retail on a site described in root CLAUDE.md as a "wholesale
product catalog" — backwards from the intent. This also lines up with
[[project-retail-anchor-pricing-flip]]'s same-day customer-group change:
all 3,461 real Erply customers are now in the Wholesale group, so the
public storefront price now matches what those customers actually pay.

**How to apply:** if the displayed storefront price ever looks off again,
check `WHOLESALE_DISCOUNT` in `lib/erply.ts` against Erply's live Wholesale
price list `discountPercent` (`check-erply-price-list-rules.mjs`, read-only)
before assuming the code is still correct — the discount percentage is a
live, admin-editable value in Erply, not a compile-time constant kept in
sync automatically. If `WHOLESALE_DISCOUNT` and Erply's real discount ever
diverge, `scripts/sync-prices-only.mjs` needs its copy updated too (no
shared import between `lib/` and `scripts/*.mjs`).
