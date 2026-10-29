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

**Survived the first sync (2026-10-29):** the 08:32 UTC cron run updated all
3,215 products and every hold held (186 held, 0 with price_cents ≠
held_price_cents; S121035 still $11.00 live).

**Full file check, 2026-10-29:** of the 775 rows with a NEW PRICE, 632 of the
686 without a note match live (all 185 held ones included), and 89 don't (51
without a note, 38 with one). The misses are mostly unit
questions, not errors: the file looks per piece where the catalog sells a
pack/case, or the live price is about QuickBooks cost (maybe too low). They went
to the price setter as `Downloads/price-review-mismatches-20261029.xlsx`
(group, live vs file × 2.4, note, blank "Correct website price"); not applied.
The plain ×2.4 rule is wrong for this check: use `roundToQuarterSkip75`, or the
held rows look 25¢ off.

**Second use, 2026-10-29:** the 6 rows whose note gives the price: T642243 and
T651002 $9.50 ("make it 9.50 on website", overriding ×2.4), F287570/71/73
$13.25 ("PACK OF 20 PCS"), T641798 $12.00 ("DOZEN"). Audit rows written before
the update (performed_by `Claude Code: price review notes 2026-10-29, ...`);
log/undo `data/price-hold-20261029-log.csv` / `-undo.sql`; Erply list
`Downloads/LIVE_price_updates_for_erply_20261029.xlsx`. 192 held after.
F286844 (Oasis foam, "box of 48, only sell by case") stays a single brick
(user, 2026-10-29): $25/48 × 2.4 = $1.25, already the live price, so no
change.

**Why:** Erply's API can't set prices on this account, so the catalog has to
hold the price until someone keys it by hand.
**How to apply:** for any future catalog-side price change, set price_cents and
held_price_cents together (with audit rows); never set price_cents alone.
