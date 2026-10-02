---
name: project-needs-pricing-tab-20261002
description: 2026-10-02 - /admin/cleanup?issue=pricing built (pull prices from Erply now + unhide receiving cohort); live price formula is Erply price x1 (RETAIL_MULTIPLIER, since 2026-08-21), NOT x0.5 -- scripts/sync-prices-only.mjs is stale and would halve every price on --apply
type: project
---

**Decision (Dragon, final, 2026-10-02):** prices are never set in the catalog.
They're entered in Erply by hand, and the Erply sync owns `price_cents`. The
"Needs pricing" tab only (a) pulls prices from Erply on demand
(`/admin/api/cleanup/pull-prices`) and (b) unhides receiving-cohort products
once they're priced (`/admin/api/cleanup/unhide`). The rules live in
`lib/needs-pricing.ts`.

- **Cohort** = SKUs where `shipment_lines.erply_created_product_id` is set,
  upper-cased. This is the same rule as `zero-price-visibility.mjs --unhide`.
  "Priced + hidden" alone is NOT a signal: **2,027** active priced products
  were hidden on 2026-10-02 (2,125 hidden overall, out of 3,310 active). The
  "~144 hidden by choice" figure in older notes is long stale.
- Live 2026-10-02: Ready to show **0**, Price in Erply **98**. Of those 98,
  88 are in the cohort, 96 have a QuickBooks record and 11 have a QB price.
  A read-only Erply read found 97 still at $0 there and 1 missing.
- **10 unpriced products sit outside the cohort**: F287699, F288020,
  K229536-K229540, F286614-RD, F286614-PK, F286425-P. Once priced they won't
  show up under Ready to show. The screen flags them, and unhiding them is a
  separate call.
- The pull route reads Erply's whole active catalog through
  `getErplyProducts()` (~5.5s, 16 pages), not a per-code lookup. Reasons: it's
  the cron's exact data path, it opens one session, and
  `getErplyProductByCode` returns the RAW price, not the normalized one. It
  only writes rows still at <=0, with that guard in the UPDATE, so it can
  never move a real price.
- `syncPriceCents()` in `lib/erply.ts` is now the one dollars->cents step.
  Both sync routes and the pull route use it.

**Formula gotcha:** `lib/erply.ts` has used `RETAIL_MULTIPLIER = 1` since
2026-08-21: the catalog stores Erply's retail price quarter-rounded, and
`price_tiers` applies tier discounts. So
[[project-storefront-wholesale-quarter-rounding]]'s x0.5 is superseded.
`scripts/sync-prices-only.mjs` still hard-codes `WHOLESALE_DISCOUNT = 0.5`
and claims to mirror lib. Running it with `--apply` would halve ~3,000 live
prices. It was **deleted 2026-10-02** (Dragon's call) rather than fixed. The Pull button and
the cron cover what it did.

**How to apply:** for any price question, read `normalizeProduct` in
`lib/erply.ts`, not the memory nodes or the .mjs mirror. Never treat "hidden
and priced" as "should be visible" without the cohort. See
[[project-receiving-to-catalog-20260923]] and [[project-admin-cleanup-queue]].
