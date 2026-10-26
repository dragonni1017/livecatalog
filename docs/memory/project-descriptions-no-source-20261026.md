---
name: project-descriptions-no-source-20261026
description: 2026-10-26 (#177) — no real product descriptions exist anywhere (catalog, Erply, QuickBooks, WooCommerce); every non-blank catalog description is a name copy, now hidden on the storefront and counted as missing in Cleanup. Real copy needs staff; don't generate it from names
type: project
---

**Finding (2026-10-26).** All 3,215 active products (1,183 visible) have a
blank description (348) or a copy of an Erply name plus "/cs" (2,867). None
has real text. Every other source was checked and has nothing better:
QuickBooks `sales_desc` is the name plus carton size and weight. WooCommerce
(3,368 products) is the name plus "Please contact the warehouse for case
pricing", and at most 6 add carton dimensions. Erply is where the copies came
from.

**Why the copies are worse than nothing.** Descriptions are catalog-owned:
the sync writes one only when it creates a product
([[project-admin-cleanup-queue]]). Renames don't reach it, so 42 copies were
stale. Some contradicted the current pack spec (the 10" gift bows:
`100/pk 20bx/cs` against `20/pk 100bx/cs`), and two named a different product
(a pink plush bear described as "Pink Love Teddy Plush w/ Lights 30cm").

**What #177 did.** `lib/product-description.ts` treats a description as a
copy when its words are all in the name, or when it ends in the sync's
`N/pk Mbx/cs cs.X/cs` tail (which catches stale copies of older names). The
product page, its meta description and its JSON-LD skip copies. /admin/cleanup
counts them as "No description" (about 3,215, was 348) and opens the editor
empty. No data was changed.

**Not done, on purpose.** Writing descriptions from the name only rewords
it. Anything more (materials, uses) would be invented, and buyers order on
it. Offered as an option: a pilot that writes only what's visible in the
product photo plus size and pack from the name, into a review file. Real copy
has to come from someone who knows the products.
