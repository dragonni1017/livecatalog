---
name: project-price-sheet-base-20261112
description: 2026-11-12/13 price check: review sheet NEW PRICE = base (×2.4 = retail); all 1,037 sheet prices now live (65 applied 11-12 by request, incl. ~50 per-pack drops); 17 rows look retail-typed; LY_prices_by_SKU file is 2.4x (WooCommerce-era); Erply left alone; /admin/catalog-health
type: project
---

**The price model, confirmed.** In `LIVE_price_review_simple.xlsx`, "NEW
PRICE" is a **base** price and base × 2.4, rounded with
`roundCentsToQuarterSkip75` (lib/order-rules.ts), = the catalog/Erply
**retail** price. Tiers are discounts off retail (Wholesale −50%, Chain −54%,
Exclusive −38%). Evidence: 686 of the 1,038 typed prices are about the row's
retail ÷ 2.4, 141 equal QuickBooks.

**17 rows look retail-typed:** the typed number equals the retail price
beside it, so they went up 2.4× (K229521, P273843-45CM, 3D801313, F286543…).
List: `data/sheet-typed-equals-retail-20261112.csv`. Not changed; the
pricing owner's call.

**2026-11-12: every remaining sheet price applied at the user's request**
(65 rows). The user picked "all 65" after being shown that ~50 were per-piece
entries already live as the right per-pack price (they dropped ~12×, e.g.
H424181 $43.25 → $3.50) and 3 undid the reviewer's notes (T642243/T651002
→ $15.50, F286844 → $60). Log/undo: `data/price-sheet-apply-20261112-*`.
The SQL editor rolled the CTE back twice (see the auto-memory note on prod
writes); the `!` script landed it. After: catalog 1,037/1,037 = sheet × 2.4,
Erply 649 match + 386 held, 389 held in total.

**`LY_prices_by_SKU_2026-11-09.xlsx` is 2.4× too high.** Its "Catalog base
price" is really the catalog retail price, so its Retail = retail × 2.4.
"Site status" Published/Draft/Private are WooCommerce terms, which points to
the old WooCommerce 2.40x markup. Woo prices equal the catalog since
2026-11-11 ([[project-woo-vs-catalog-20261104]]). Whether the file was sent
anywhere: unanswered.

**Erply:** import files are in `data/erply-price-import-*` (387 rows, a
1-product TEST file, and a REFERENCE file). The user said "leave Erply alone"
(2026-11-12), so don't push or chase it.

**Checks now on `/admin/catalog-health`** (#263): visible products'
price/photo, photo files on demand (8 thumbnail-sized found 11-12), sync,
low-stock recipient, storefront price display (off), held count, stale
review items (38 already at the suggested price), and searched codes not in
the catalog.

**Why:** pricing was checked from several directions over two days; this
records which reading is right, so it isn't re-derived.
**How to apply:** treat sheet/review prices as base and compare with
`roundCentsToQuarterSkip75(base × 240)` cents, not a plain ×2.4 or quarter
round. Before quoting held counts, count `held_price_cents > 0`. Related:
[[project-held-prices-20261028]], [[project-price-file-pass-sold-out-hides-20261110]].
