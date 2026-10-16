---
name: project-customer-pricing-20261016
description: 2026-10-16 ONE customer-pricing rule (lib/customer-pricing.ts) shared by /api/orders, /api/cart/reprice and priced line cards/price lists; fixed the cart ignoring flat discount_percent; "Prices at" = catalog / tier / customer
type: project
---

`lib/customer-pricing.ts` decides a customer's discount, and it's the only
place that does:
- an active assigned `price_tier_code` wins
- otherwise the flat `customers.discount_percent`
- never stacked

It's applied with `applyTierDiscount` (quarter-rounded). Used by:
- `/api/orders`: the real charge, only when signed in as the order email
- `/api/cart/reprice`: the cart preview
- `lib/price-scope.ts`: the "Prices at" option on `/admin/line-card`,
  `/rep/line-card` and `/admin/price-list`. The URL param is
  `price=tier:<code>` or `price=customer:<uuid>`, and anything unknown or
  inactive falls back to catalog price.

- **A bug was fixed in passing.** The cart preview only read the tier, so a
  customer with a *flat* discount saw full price in the cart and was charged
  less on the order. Nobody had a flat discount (2 profiles, both tiered),
  so nobody hit it. The live e2e now covers it.
- Rep tier selection in the header (TierSwitcher, `TIER_COOKIE`) is a
  separate rule that overrides customer pricing in orders/reprice, and it
  was not changed. The price list's "Prices at" is chosen explicitly, not
  from the cookie.
- Prices are **per unit**. Volume-tier breaks (`products.volume_tiers`) are
  not shown on printed lists.
- `/admin/price-list` now also excludes `price_cents = 0` (it used to list
  unpriced products at $0).
- Reps see customer profile names in the "Prices at" list, the same names
  they'd price for in the order flow anyway.
- `/admin/price-list`'s rendered output wasn't checked live (it needs an
  admin session, and no throwaway admin was created). It shares the tested
  `resolvePriceScope` and `applyTierDiscount`.

**Why:** a buyer-specific price sheet, and three copies of the same pricing
rule had already drifted once.
**How to apply:** any new place that shows or charges a customer's price
calls `resolveCustomerPricing` / `pickCustomerPricing`. Don't re-query
`customers.price_tier_code` by hand.
