---
name: project-woo-vs-catalog-20261104
description: 2026-11-04 full WooCommerce vs catalog comparison by SKU; same products and names, but Woo publishes 3,193 vs 1,183 shown here, 2,799/3,190 Woo prices exactly 2.40x (other 391 all explained, 0 real mismatches), 872 stock disagreements; handoff sheet made for the Woo team, who own that site
type: project
---

**Compared 2026-11-04** (read-only, `data/woo-vs-catalog.mts`, WooCommerce REST
`wc/v3/products?status=any` with the local `WOO_*` keys; WooCommerce is NOT
configured in Vercel production). Handoff for the Woo team:
`Downloads/woocommerce-handoff-for-woo-team-20261104.xlsx`
(`data/woo-team-handoff.mts`).

**Same products and names.** 3,368 on Woo (3,193 published, 175 draft, all
simple products, every one with a SKU, no duplicates), 3,364 in the catalog;
3,361 match by SKU. Nothing in the catalog is missing from Woo; 7 Woo drafts
are not in the catalog. Name "differences" are formatting only: 101 are Woo's
HTML entities (`&amp;`, `&#8243;`), 145 still use the old `SKU - name` form.
Decode entities before comparing names, or every "&" reads as a mismatch.

**What's shown differs a lot.** Woo publishes all 2,032 products hidden here
(1,112 hidden by decision, 772 no photo, 121 $0, 27 both). 22 shown here are
Woo drafts.

**Price: 2,799 of 3,190 Woo prices are exactly 2.40x the catalog**, the old
"Retail = base + 140%" markup from
[[project-woo-price-integration-markup-bug]]. The other 391 are all
explained, 0 real mismatches:
- 183: held prices ([[project-held-prices-20261028]]) set here, not yet in
  Erply, so Woo still has the old price.
- 142: discontinued, not in Erply (inactive here, Woo drafts with old prices).
- 66: rounding only; Woo is 2.40x the exact Erply price and the catalog
  rounds to the quarter, which skews the ratio on cheap items.
So "2.40x everywhere" was wrong as first stated; check the tail before
quoting a ratio.

**Stock: 872 disagree on in-stock.** 851 are in stock here but out of stock
on Woo, none of them shown here; consistent with the August no-photo
out-of-stock write ([[project-woo-direct-outofstock-write]]).

**Why:** the question "how accurate is the catalog vs WordPress" will come
back; this is the answer and where the numbers came from.
**How to apply:** re-run the two `data/` scripts for fresh numbers. Woo-side
decisions (publish, price plugin, stock) belong to the team that runs the
WooCommerce site; this repo only reports them.
