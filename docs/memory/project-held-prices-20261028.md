---
name: project-held-prices-20261028
description: 2026-10-28 held prices (migration 0068) — catalog price kept by the Erply sync until Erply matches; 186 price-review prices applied live
metadata:
  type: project
---

`products.held_price_cents` (migration 0068, PR #197) is the one way to set a
price in the catalog that the daily Erply sync won't undo. `syncToSupabase`
keeps `price_cents` at the held value until Erply sends the exact same cents,
then clears the hold (`resolveHeldPrice`; `ImportResult.heldPrices`
kept/released). Admin PATCH of a price moves an existing hold with it. A held
product is not zero-price-hidden. Supersedes "the sync owns price_cents" in
[[project-needs-pricing-tab-20261002]] only for held rows.

Held values must be `roundToQuarterSkip75` of the intended Erply price, or the
hold never releases.

**First use, 2026-10-28:** the LIVE_price_review_simple.xlsx review (new
base × 2.4 = catalog/Erply retail, per [[project-retail-anchor-pricing-flip]]),
only the rows that differ: 235 → 188 after rounding → **186 applied** (T641519
and T641730 are inactive, out of the Erply feed). Audit action
`product_price_held`; local log/undo `data/price-hold-20261028-log.csv` /
`-undo.sql`. The price-setter enters the same values in Erply from
`Downloads/LIVE_price_updates_for_erply.xlsx`; check `select count(*) from
products where held_price_cents is not null` to see how many are still waiting.

**Why:** Erply's API can't set prices on this account, so the catalog has to
hold the price until someone keys it by hand.
**How to apply:** for any future catalog-side price change, set price_cents and
held_price_cents together (with audit rows); never set price_cents alone.
