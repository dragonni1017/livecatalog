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

**Batch 3 (2026-10-27, applied: 25 live, 72 in all).** Same selection, also
skipping K229473 and D701018. The file is `data/description-batch-03.csv`.
All 25 were saved from a fresh tab, read back (3,179 characters), and the
live prod-00470 page was checked. 5 of the 30 got no description.

- **Photo problems (photo needs replacing):**
  - P273668 "Fluffy Pig Slippers" has the **wrong photo**: white teddy bears
    holding "Love" hearts. This is the second one, after K229473.
  - Too blurry to read: H424270, F561926, D701098, D701004. Products whose
    `image_url` is a bare Cloudinary SKU id are older uploads and blurry more
    often.
- **Found, nothing fixed yet:**
  - D701115 "Hair Clipper Set" is decorative hair clips (a clip plus a bobby
    pin), filed under Deco.
  - Case counts: T641712 is 24/cs on the label and in QuickBooks, 36 in the
    name. 3D801158 is 144 on the label and in the name, 96 in QuickBooks.
    D701097 has the same boxes-vs-pins issue as D701081.
  - S162760's name inverts the pack layout (12/pk 20bx against 20/box ×
    12 boxes; same 240).
  - F287300: QuickBooks says red, the photo shows red, purple and pink.
  - Name text: "Harbrushes" (H424269), leftover "1000 ea/..." (F287570).

**Batch 4 (2026-10-27, applied: 29 live, 101 in all).** Same selection, also
skipping batch 3's photo problems. The file is
`data/description-batch-04.csv`. All 29 were saved from a fresh tab, read
back (4,353 characters), and the live prod-02768 page was checked. 1 of the
30 got no description.

- **Third wrong photo:** P273606-2 "GWL Brown Wolf Slippers" has a blurry
  photo of teddy bears holding hearts. All three wrong photos (K229473,
  P273668, P273606-2) are slippers, keychains or bears showing another
  product, so the photo upload for those lines likely mixed SKUs up.
- **Found, nothing fixed yet:**
  - Case counts: P256789 is 30/cs on the label, 20 in the name and
    QuickBooks. F287431 is 600 pks/cs on the label, 50 in the name.
  - Pack layout inverted, same totals: T641325 and F287704 (against
    QuickBooks or the label), and the spray fans T641109, T641111 and
    T641522 (label 9/bx × 8, name 12/pk × 6).
  - F286543 "LOVE Letters RED" shows hot pink roses, so the colour was left
    out. Confirm whether the heart box is included.
  - B325088 "Hand Clutch" has a shoulder chain. F287433 "Brown" baskets are
    tan and white, like F287432.
  - Name typos: "Desert" for Dessert (B325102), "Harbrushes" (H424268),
    "Myster" (3D801162), "Pluses" (P273756).
- Text printed on a product (P273756's "Positive potato" card) is
  paraphrased, not quoted in full.

**Batch 5 (2026-10-27, applied: 29 live, 130 in all).** Same selection, also
skipping P273606-2. The file is `data/description-batch-05.csv`. All 29 were
saved from a fresh tab, read back (3,534 characters), and the live
prod-00614 page was checked. Fewer flags (7 against 12-17), because most of
these photos are newer uploads with clear labels.

- **Fourth wrong photo:** P273781, Positive "Brown Bear" Crochet Keychain,
  shows a capybara keychain. It has no description.
- **Found, nothing fixed yet:**
  - Feet for inches again: D701045-White's name says 47.2', the label says a
    47" pole. Same mistake as F286863.
  - Name doesn't match the photo (animal or use left out of the
    description): P273710 "Headband" is worn on the wrist, T641884
    "Unicorn" has no horn, and P273773 "Brown Bear" has a capybara-like face.
  - Case counts: T641963 is 25/cs on the label and in QuickBooks, 20 in the
    name (plus the typo "Footbal"). F287531 is 50 on the label and in
    QuickBooks, 48 in the name.
  - T641941: the label size (12" x 4" x 3") doesn't fit a 40oz mug, so it
    was left out.
