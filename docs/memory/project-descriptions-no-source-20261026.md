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
it. Real copy (materials, uses) has to come from someone who knows the
products.

**Photo pilot (2026-10-26, NOT applied).** 20 visible products, one per
category, described only from what the photo shows, into
`data/description-pilot.csv` (local; columns sku, id, current_name,
proposed_description, from_photo, check). 19 were written; D701018's photo
was too blurry.

- **Product photos are a data source.** 16 of 20 carry a printed L&Y label
  with the item dimensions, the case count (sometimes per-pack), the UPC and
  sometimes a variant suffix (`F286501-BLK`, `F561935-MIX`). Fetch them small
  through Cloudinary (`/upload/w_500,f_jpg,q_70/<public id>`).
- **The labels disagree with catalog names**, so the pilot doubled as an
  audit. Nobody had checked these when the pilot ran: F287657 (photo 100
  pcs/pk, name 10/pk), F286756 (64 vs cs.60), F286863 (bow 10" vs name 10'),
  D701083 (3" vs 3.2inch).
- Applying: once the user approves rows, use one UPDATE in the SQL editor
  and read it back. The sync never overwrites a description, so approved text
  sticks. Next, if wanted: labelled photos first, in batches, always into a
  review file first.
