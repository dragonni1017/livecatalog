---
name: project-retail-anchor-pricing-flip
description: 2026-08-04 -- Erply pricing model flipped from base-is-floor/tiers-markup to retail-is-anchor/tiers-discount; all products + all 3,461 customers updated live, discountPercent rounding accepted
type: project
---

**Decision (2026-08-04):** Dragon flipped the pricing model. Originally
(see [[project-erply-customer-tiers]]) Base was the floor price and the
other 4 tiers were markups over it (Wholesale +20%, Distribution-Chain
+10%, Exclusive +50%, Retail +140%). Dragon decided instead: **Retail
becomes the anchor price everyone sees by default, and the other tiers are
now real discounts off Retail** — same dollar prices as before, just
re-expressed. Also: **Retail is now the default tier for all customers**,
both the existing base and anyone new going forward (supersedes the
Wholesale-default decision in [[project-tier-auto-suggestion-blocked]] /
[[project-woocommerce-tier-mapping]] from earlier the same day) —
`DEFAULT_TIER` in `lib/tier-mapping.ts` was updated accordingly.

**Why:** Dragon's own words: "this way when the price tiers are set up the
products are getting discounted" — i.e. new/default customers should see
the full (retail) sticker price, with tiered customers getting a visible
discount rather than everyone starting from a low floor and select
customers getting marked up.

**What was actually run, in order, all live against production Erply
(confirmed via dry-run-then-verify on each step, per this project's usual
caution pattern):**

1. `scripts/rebase-prices-to-retail.mjs --apply` — overwrote `price` and
   `netPrice` on all 2,871 Erply products (2,870 active + 1 inactive) to
   `oldPrice * 2.4` (old base -> old Retail amount). 0 failures. Backup of
   every old/new price pair is in
   `data/price-rebase-review/planned-price-changes.csv` — this is the
   revert path if this ever needs undoing (write `oldPrice`/`oldNetPrice`
   back per productID).
   - **Discovered live:** `netPrice` was `0` for every sampled product on
     this account — not actually in use, so this field write is a no-op,
     not a real second value being tracked.
2. `scripts/move-all-customers-to-retail.mjs --apply` — moved all 3,461
   Erply customers into the Retail group (id 21, re-confirmed live, not
   trusted from the cached snapshot). Pre-move breakdown: 3,460 in
   Wholesale (19), 1 already in Exclusive (23) — the one Exclusive customer
   was moved too (not special-cased).
3. `scripts/check-erply-price-list-rules.mjs` (read-only) — confirmed all 4
   non-Base price lists have exactly 7 PRODGROUP rules each (group ids
   1,18,61,36,48,60,56), one uniform `discountPercent` per list, no
   per-category customization to worry about.
4. `scripts/update-tier-discount-percentages.mjs --apply` — re-anchored the
   4 lists via Erply's real `savePriceList` API (confirmed live via
   https://learn-api.erply.com/requests/savepricelist; param name is
   `pricelistID`, lowercase "l"; rules are indexed `type#`/`id#`/
   `discountPercent#` triplets; **re-sending all existing rule ids is
   required** — "API will only update the rules specified in input data
   and leave all other existing rules unchanged"):
   - Wholesale (7): -20 -> **50**
   - Distribution-Chain (9): -10 -> **54** (target was 54.166667)
   - Exclusive (10): -50 -> **38** (target was 37.5)
   - Retail (8): -140 -> **0** (now redundant/no-op, left active rather
     than deactivated so the group->pricelist link didn't need touching)
   - Base: priceListId 0, no price list object exists, nothing to do,
     unaffected either way (fine — Base is designed to have 0 customers).

**IMPORTANT gotcha, confirmed live 2026-08-04: Erply's `discountPercent`
field rounds to a whole integer on write for this account, despite the API
docs listing its type as "Decimal."** Sent 54.166667 and 37.5, got back 54
and 38. Dragon explicitly accepted this ("I think 1 is ok" — the
"accept the rounding" option over "rebuild as thousands of per-product
fixed-price rules instead"). Actual dollar drift from the original design:
- Distribution-Chain: $110.00 target -> $110.40 actual on a $100 base (+0.36%)
- Exclusive: $150.00 target -> $148.80 actual on a $100 base (-0.8%)
- Wholesale and Retail landed on exact integers (50 and 0) — no drift there.

This isn't fixable by choosing different rounding — 1.10/2.40 and
1.50/2.40 don't land on whole percentages under any rounding choice, only
Wholesale's ratio (1.20/2.40 = exactly 0.5) happened to. If exact-cent
parity is ever required later, the only fix is switching Distribution-
Chain/Exclusive from PRODGROUP percentage rules to ~2,870 PRODUCT-type
fixed-price rules each (same `savePriceList` call, `type#=PRODUCT`,
`id#=productID`, `price#=exact dollar amount` instead of `discountPercent#`)
— not built, since Dragon accepted the rounding instead.

**Scripts added this session (all in `scripts/`, all dry-run-by-default,
`--apply` required to write):**
- `rebase-prices-to-retail.mjs`
- `move-all-customers-to-retail.mjs`
- `check-erply-price-list-rules.mjs` (read-only)
- `update-tier-discount-percentages.mjs`

**INCIDENT 2026-08-04, same session, caught and fixed within the hour:**
`rebase-prices-to-retail.mjs`'s original `saveProductPrice()` sent a `price`
param to Erply's `saveProduct` -- **`price` is not a real saveProduct
parameter** (confirmed live via
https://learn-api.erply.com/requests/saveproduct: the only price params on
that call are `netPrice` and `priceWithVAT`, "set one of them and API will
calculate the other"). It also sent `netPrice`, which read as `0` for
every product on this account (not actually populated/used here) -- so
every one of the 2,871 calls explicitly told Erply "this product's net
price is $0," and Erply auto-calculated `priceWithVAT` (the real selling
price) as $0 too. **This zeroed the actual selling price on all 2,871
products in production Erply**, not just an unused field -- the "netPrice
write is a no-op" assumption earlier in this doc was wrong.

Fixed via `scripts/fix-zeroed-prices.mjs` (new script, re-reads
`data/price-rebase-review/planned-price-changes.csv` -- the same backup
CSV the original run wrote before the bug hit -- and re-applies each
product's intended price via the correct `priceWithVAT` param, no
`netPrice` sent at all). Verified live on one SKU before running the full
restore (productID 2745 / T641746: $0 -> $4.80, matching the CSV), then
ran for all 2,871. Confirmed by re-fetching the whole catalog afterward
(not by trusting the run's own log): 2,869/2,871 restored correctly; the
remaining 2 (F286614-PK, F286425-P) were already $0 in the *original*
pre-incident data (confirmed via the backup CSV's `oldPrice` column) --
pre-existing data issue, unrelated to this incident.

`rebase-prices-to-retail.mjs` itself was also corrected in place (same
`priceWithVAT`-only fix) so re-running it from scratch in the future
wouldn't repeat this.

**How to apply:** if any future Erply `saveProduct` call needs to write a
price, use `priceWithVAT` (or `netPrice` if you actually want to set the
pre-tax price) -- never a bare `price` param, and never send `netPrice`
without first confirming what it currently holds on this account (it may
read as 0 without meaning 0). Don't trust a bulk-write script's own
"N updated, 0 failed" log as proof of correctness -- `saveProduct`
returning `responseStatus: ok` only means Erply accepted the call, not
that the params matched what you intended. Re-fetch a live sample (or the
whole set, if the count is fetchable) after any bulk financial write,
independent of the writer's own log, the way this incident was actually
caught.

**UPDATE 2026-08-06 — customer groups split from the POS default:**
Dragon wanted the POS walk-in default (no customer attached) to keep
showing full Retail price, but every *real* customer account to carry the
Wholesale discount automatically once selected at POS. `scripts/move-
customers-to-wholesale.mjs` (new, mirrors `move-all-customers-to-retail.mjs`
but excludes `POS_DEFAULT_CUSTOMER_IDS = [3]`) moved all 3,461 real
customers from Retail (21) to Wholesale (19), leaving only `customerID 3`
("POS Customer" — the `defaultCustomerID` on both physical registers,
Warehouse and Store LA, confirmed via `check-pos-default-customer.mjs`) in
Retail. Verified live after the write (not trusting the run's own log,
per this project's standard pattern): 3,461/3,461 in Wholesale, customerID
3 still Retail on both registers. Net effect: POS with no customer attached
= full retail price; POS with any real customer selected = Wholesale price
(-50% off retail, see the discountPercent section above) automatically.

**How to apply (pricing model, unchanged from before):** if anyone asks
"why is Wholesale a +50% discount instead
of a +20% markup," this is why — read this file, not just
[[project-erply-customer-tiers]] (which still describes the old markup-off-
base model and is now stale for the *pricing direction*, though its tier
group IDs/priceListIds are still correct). Before running any of the 4
scripts above again, re-verify current state live (same caution as every
other Erply script in this project) rather than assuming this snapshot
still holds.
