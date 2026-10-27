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

**Photo pilot (2026-10-26, applied: 19 live).** 20 visible products, one per
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
- **Applied 2026-10-26.** All 19 were approved and saved through the admin
  site: `PATCH /admin/api/products` from the signed-in Chrome tab. The SQL
  editor route failed three times on paste
  ([[feedback-sql-editor-runs-not-landing]]). The read-back found all 19
  with 2,389 characters matching, and the live prod-00608 page shows its
  description. One wording change from the review file: F286819's text no
  longer mentions "the photo". These went live with their checks still open:
  F286501 assumed black (-BLK photo), and C266032 (candy) had no
  food-wording review. D701018 needs a new photo.
- **Name conflicts, resolved 2026-10-27 against QuickBooks
  (`qb_item_directory.sales_desc`).** A photo label alone isn't enough to
  change a pack count, because the price stays the same and only the
  quantity changes.
  - F286863 is **fixed**. It's now `10" Purple Gift Bow - 20/pk 100bx/cs
    cs.100`, the same format as the other 10" bows. It was applied with
    `fix-product-names.ts --plan=data/product-name-fixes-conflicts.csv`,
    which verified Erply, Woo and Supabase, and the name was read back.
    QuickBooks says 1000/cs (50pk), while the photo and the name say 2000.
    The count was left alone and is still to check.
  - D701083: left as is. QuickBooks also says 3.2inch, so the photo's 3" is
    rounding.
  - F286756: **needs a count**. QuickBooks and the photo say 64/cs, but 64
    doesn't fit 12/pk, so the pack layout is unknown.
  - F287657: **needs a count**. The photo says 100 pcs/pk against the name's
    10/pk, and QuickBooks only says "100 pks/cs". At the same $2.00 that's a
    10x change.
- The sync never overwrites a description, so approved text sticks. Next, if
  wanted: labelled photos first, in batches, always into a review file first,
  then apply through the admin site.

**Batch 2 (2026-10-27, applied: 28 live, 47 in all).** The 30 visible
products with the most stock and a name-copy or blank description, at most
3 per category, skipping D701018. The file is `data/description-batch-02.csv`.
Every photo had a label. All 28 were read back (3,354 characters) and the
live prod-02781 page was checked.

- **New rule:** when a photo label disagrees with the name, leave that fact
  out of the description and flag it, so the page never contradicts itself.
  For example, 3D801155's length is left out: the label says 17.7" and the
  name says 20".
- **Found, nothing fixed yet:**
  - K229473 has the **wrong photo**: capybara keychains with a label reading
    "K228473", while the name and QuickBooks say a puppy keychain. It has no
    description until the photo is fixed.
  - IC44200 "Green Glitter Bottle" is 100 g of craft glitter, filed under
    Drinkware & Cups.
  - Every chenille colour's label says 100 pcs/pk against 10/pk in the name
    (F287657/58/59).
  - 3D801155: the label and QuickBooks say 216/cs, the name says 240.
  - D701081: the label says 480 boxes/cs, the name means 480 pins.
  - S121034-G: name typo "Dumping".
  - F287475: the photo label shows F287472 (the red bow) on a white bow.
  - F287415: the photo shows red and pink together; check whether a pack is
    mixed.
- **Applying:** the admin tab froze, and a reload didn't help. A new tab
  (`tabs_create_mcp` → `/admin`) kept the sign-in and saved all 28 in one
  `javascript_tool` call. After a timeout, check the database before
  retrying: in this case nothing had been sent.
