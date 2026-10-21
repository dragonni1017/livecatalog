---
name: project-case-prices-20261021
description: 2026-10-21 — 79 active products priced as a whole case (76 are 60bx/cs floral paper at $144-$240 vs ~$3/pk); 9 live, 68 hidden; /admin/cleanup "Case price?" tab + Needs pricing unhide-all skips them
type: project
---

`lib/price-check.ts` flags a price that is >=20x its category's median
where the name states >=24 bx/cs and price / boxes lands within 2x of the
median. Shared by `/admin/cleanup?issue=case-price`, the Needs pricing
tab (a flagged row is left out of "Unhide all", its own Unhide still
works) and `scripts/build-price-outlier-list.mjs`.

**First live run, 2026-10-21: 79 active products flagged, 9 of them live.**
76 are floral paper (`F286xxx`/`F287xxx`, "20/pk 60bx/cs") at $144-$240,
in a category where 247 of the 323 60bx/cs papers sit at $3-$7 per pack, so
it is a case price, not a convention. All are `unit_type = pc`. **68 are
hidden**: harmless until someone unhides them in /admin/products, which
would put a case price on the storefront. None are in the receiving cohort.
The rest: H424183 ($43.25 = 30 bx x $1.44) and PF20200934-RD.

**How to apply:** prices are fixed in Erply, never in the catalog (see
[[project-needs-pricing-tab-20261002]]); the handoff page lists the live 9.
Medians come from visible products only, so a hidden batch of case prices
can't raise its own category's median and hide itself.
