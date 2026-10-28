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
  product. Photos may have been mixed up between neighbouring SKUs when
  they were uploaded; not confirmed (see the K229470 lead in batch 6).
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

- ~~Fourth wrong photo: P273781~~. **Corrected in batch 6:** "Brown Bear"
  is the catalog's name for its capybara items, so the capybara photo is
  probably right. P273781 still has no description; it can get one in a
  later batch.
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

**Batch 6 (2026-10-27, applied: 29 live, 159 in all).** The file is
`data/description-batch-06.csv`. All 29 were saved from a fresh tab, read
back (3,595 characters), and the live prod-02386 page was checked. Only 6
flags.

- **"Brown Bear" means capybara.** Every "Brown Bear" product photographed
  so far shows a capybara: P273747 (slippers), P273744-23cm (sitting
  plush), P273781 (keychain) and P273773 (backpack). On 2026-10-27, 39
  active products had "Brown Bear", "Cappy" or "Capybara" in the name, most
  of them "Brown Bear" (often in quotes). A buyer searching "capybara" misses
  them. Renaming is the catalog owner's call, and nothing was renamed. Until
  then, descriptions for these say "brown plush animal" (no species), so
  they contradict neither the name nor the photo.
  - Lead, not confirmed: K229473's capybara-on-pool-float photo may belong
    to K229470, "Unicorn Riding 'Brown Bear' Keychain".
- **Wrong photo:** F286809 "Mint Colored Ruffle Styled Flower Paper" shows
  F286809-GRAY, a grey gift box set. It has no description.
- **Found, nothing fixed yet:** F287534 is 16 sets/cs on the label and in
  QuickBooks, 20 in the name. P273766 has the typo "Fuffly" (and it's
  slippers, not sneakers). F287535 "Gray" shows white and grey.
- Display boxes that print "2 in 1 plain mirror and magnifying glass" (the
  T6419xx slim compacts) are enough to state that in the description.

**Batch 7 (2026-10-27, applied: 30 live, 189 in all).** The file is
`data/description-batch-07.csv`. The first batch where all 30 got a
description, including P273781 (see the batch 6 "Brown Bear" note). All 30
were saved from a fresh tab, read back (3,735 characters), and the live
prod-01594 page was checked. Only 4 flags:

- F286507's name says 240/cs and QuickBooks says 300; the handwritten
  label is unreadable.
- F286894 and F286893 say "with Clear Lid", but no lid is visible.
- P273781's "Brown Bear" naming.

Label sizes that only make sense with an accessory (T642007's 9.5" mirror,
probably including the strap) are left out. Props in the photo are described
as shown ("shown filled with moss"), not as included.

**Batch 8 (2026-10-27, applied: 29 live, 218 in all).** The file is
`data/description-batch-08.csv`. All 29 were read back (3,966 characters),
and the live prod-01465 page was checked. D701114 got no description: a
blurry, bare-SKU-id photo.

- **Case counts:** F286668 is 240 on the label and in QuickBooks, 540 in the
  name. 3D801207 is 48 on the label and in QuickBooks, 192 in the name.
  3D801205 is 84 on the label and in the name, 96 in QuickBooks.
- T642029 has the same odd "12 x 4 x 3" label size as T641941, so it was
  left out.
- Colour variants of an already-described product (sprays, glitter roses,
  manicure sets, pearl garlands, bouquet boxes) reuse the same sentence with
  their own colour, so related products read alike.
- When the Chrome extension disconnects ("Browser extension is not
  connected"), stop and ask the user to reconnect. Nothing is sent in that
  state, so there's nothing to clean up.

**Batch 9 (2026-10-27, applied: 29 live, 247 in all).** The file is
`data/description-batch-09.csv`. All 29 were read back (3,802 characters),
and the live prod-01466 page was checked.

- **Wrong photo:** F286877-2 "Wicker Style Print Paper Bag" shows F286877,
  the plain pink quilted bag. It has no description.
- **Case counts:** the chain-handle bags F286996 and F286995 are 240/cs on
  the label and in QuickBooks, 180 in the name.
- T642048 is another "Brown Bear" capybara (animal left out). T642034's
  photo label is blacked out (no size). F287790's label size is unclear
  (left out).
- F287483: the display box says the rose lights up, so the description
  attributes that to the box ("box that says it lights up") rather than
  claiming it.
- **Extension "not connected" after the user reconnected:**
  `list_connected_browsers` showed the browser connected and in use, and
  the next `tabs_context_mcp` worked. Check that before asking the user
  again.

**Batch 10 (2026-10-27, applied: 30 live, 277 in all).** The file is
`data/description-batch-10.csv`. All 30 got a description. All were read
back (3,754 characters), and the live prod-01443 page was checked.

- **F287835's name is truncated** to "2-in - 1/pk 36bx/cs cs.36" on the live
  site. QuickBooks has the full name, "2-in-1 Set Round Plastic Rattan Style
  Flower Pot Set".
- **Chenille, 4th colour:** F287655 (fuchsia, no pack spec in its name)
  also says 100 pcs/pk on its label, the same as F287657/58/59. That's
  stronger evidence the 10/pk names are wrong, but still uncounted.
- **QuickBooks disagrees with the label and name:** 3D801220 (QuickBooks 96
  against 192) and F287832 (QuickBooks 12 sets against 9).
- T642115 is another "Brown Bear" capybara. Name typos: "Silione"
  (K229367), and "Diamon" plus leftover "180 ea/sc" (F287074).
- `javascript_tool` can fail with "Couldn't determine which page this
  action targets" even right after `tabs_context_mcp`. Re-navigating the
  same tab and running a one-line probe (`location.pathname`) fixed it.
  Nothing runs when that error appears.

**Batch 11 (2026-10-27, applied: 28 live, 305 in all).** The file is
`data/description-batch-11.csv`. All 28 were read back (3,520 characters),
and the live prod-02960 page was checked. F287429 got no description
(blurry, bare-SKU-id photo).

- **QuickBooks has two entries under T641015:** the pineapple lamp and one
  named "Umbrella Unicorn". The batch query returned T641015 twice because
  it joins on `qb_item_directory.sku_norm`. Deduplicate by product id when
  picking a batch.
- G333144 "Gift Bags Small" (240/cs in the name and QuickBooks): the photo
  label says 180/cs and 12.5", which looks like the large size's photo. The
  size was left out of the description.
- F287117 is 80/cs on the label and in QuickBooks, 72 in the name.
  QuickBooks says 3D801232 is "68/cs", probably meaning 168.
- Name typos for the next fix round: "Kechains" (K229391) and "Billing" for
  Bling (K229387).
- Template text needs a read-through before applying. The bling-mug
  template produced "…with a white handle, with a handle…", which was fixed
  in the file before applying.

**Batch 12 (2026-10-27, applied: 29 live, 334 in all).** The file is
`data/description-batch-12.csv`. All 29 were read back (3,948 characters),
and the live prod-01467 page was checked. F286965 got no description
(blurry). From here the batch query uses `distinct on (p.id)` against the
duplicate QuickBooks rows.

- **A second truncated "2-in-1" name:** F287843 reads "2-in - 1/pk 12bx/cs
  cs.12". QuickBooks has "2-in-1 Set Cream Color Corrugated Plastic Vase".
  Names starting "2-in-1" seem to have been cut at the hyphen when they
  were created, so search for others (`name like '2-in -%'`) before the
  next fix round.
- **G333144 confirmed:** the medium heart bag G333148's label (12.5" x
  10.25", 180/cs) matches G333144's photo label, so the "Small" bag shows
  the medium photo.
- **Case counts:** T642128 is 24/cs on the label and in QuickBooks, 36 in
  the name ("Brown Bear" capybara print, animal left out). 3D801233 is 48 on
  the label, 72 in the name and QuickBooks.
- Name typo "Bacsket" (F287541). F287542's QuickBooks sales description is
  only the UPC. D701104's label size reads 1.4' x 59' (left out).
- Proofreading every built description before showing the batch caught a
  clumsy template again (the plush keychain list). Print the descriptions
  and read them, every batch.

**Second name-fix round, applied 2026-10-27.** 6 renames went through
`data/product-name-fixes-typos-20261027b.csv`, with all three systems
verified and no skips, and the names read back.

- The search `name ~* '^\d-in\s*-\s'` found **three** truncated names:
  F287843 (visible), plus F287459 and F287845 (both hidden). All three got
  their full names from QuickBooks, so **none are left**.
- Typos Kechains (K229391), Billing to Bling (K229387) and Bacsket
  (F287541).

That makes 20 names fixed on 10-27 (F286863, 13, and 6).

**Batch 13 (2026-10-27, applied: 30 live, 364 in all).** The file is
`data/description-batch-13.csv`. All 30 were read back (3,803 characters),
and the live prod-01329 page was checked. Every photo was usable, so none
were left blank. The batch query is unchanged, with F286965 added to the
bad-photo exclusions.

- **Case conflicts:** 3D801239 (the label and name say 96/cs, QuickBooks
  says 48), and 3D801238 (the label says 350/cs, the name 348, QuickBooks
  240).
- **Sizes left out as implausible:** the "Large" squid 3D801239 (printed
  2.8" x 1.2") and the spiral jellyfish 3D801240 (1.8" x 0.6").
- G333153 is named "Floral Pattern", but the photo shows gold dots.
- F283918, K229398 and F287694 have no QuickBooks entry.

**Batch 14 (2026-10-28, applied: 28 live, 392 in all).** The file is
`data/description-batch-14.csv`. All 28 were read back (3,099 characters),
and the live prod-01332 page was checked. Two got no description: F287526's
photo is a tiny blurred placeholder, and E273127's is blurry.

- **Reversal log, from this batch on.** The products PATCH route writes no
  audit entry for a description edit, so each change was logged twice: the
  local `data/description-batch-14-log.csv` (old and new text, with
  `-undo.json` as a ready PATCH payload), and 28 `audit_log` rows (`action
  = 'product_description_updated'`, `old_value`/`new_value`, `performed_by`
  naming the batch). The old text was the name plus "/cs" (P273810-60cm's
  was blank).
- **Wrong-size photo:** P273810-60cm (24") uses the 46cm photo, so the size
  is left out.
- **Pack and case conflicts:** E273133's label says 3 pcs/pk and 288 pk/cs
  against 12/pk cs.288 in the name. F287151-S is 140/cs on the label and in
  QuickBooks, 120 in the name. F287833 is 16 sets on the label and in the
  name, 12 in QuickBooks.
- T642163 "Floral" shows butterflies (print left unnamed). K229406 is
  another "Brown Bear" capybara. 3D801241's 2.4" "Large" size was left out,
  like 3D801240. F287154's name has leftover "9*6.06*1.5 24ea".
- Lead: G333155's gold-rectangle photo looks like the one on G333153
  "Floral Pattern" (batch 13).
- The storefront product URL is `/product/<id>` (singular).

**Batch 15 (2026-10-28, applied: 30 live, 422 in all).** The file is
`data/description-batch-15.csv`. All 30 were read back (3,368 characters),
and the live prod-01232 page was checked. Logged the same way as batch 14:
30 `audit_log` rows plus `data/description-batch-15-log.csv` and
`-undo.json`. Every old description was checked to be exactly name + "/cs"
before applying.

- **Name doesn't match the photo (left out):** K229410 "Starfish" charms
  are seashells. K229414 "Pink & White Dog" shows black and pink dogs.
- **Counts:** E273134 is 144/cs on the label and in QuickBooks, 288 in the
  name. F287672: label 150 pcs/cs, QuickBooks 150 pk/cs, name 48/pk.
- F287156's name size (7.5*4*7.1) disagrees with the label (7.5" x 4.5" x
  1.5"), so its description has no size. Tiny 3D keychain label sizes
  (3D801249, 3D801248) were left out.
- For the next name-fix round: D701047 16' (feet) for 16" (inches); typos
  "Erase" (E273136), "Monter" (E273134), "Turlte" (3D801248),
  "Rectaungular" (G333166, G333167); leftover sizes in F287155/F287156 and
  F287154 (batch 14).

**Batch 16 (2026-10-28, applied: 28 live, 450 in all).** The file is
`data/description-batch-16.csv`. All 28 were read back (2,926 characters),
and the live prod-00534 page was checked. Logged like batch 15 (28
`audit_log` rows, log CSV, undo JSON). P257216 and T641505 got no
description (blurry); add them to the bad-photo exclusions.

- F287859 "Butterfly-Pattern" shows a flower border (pattern left unnamed).
- 3D801255 is 72/cs on the label and in the name, 12 in QuickBooks.
- QuickBooks colours are incomplete: F287297 "pink & red" and F287298 "red"
  also show purple (and pink).
- Character look-alikes (the K229418 fish) are described generically, not
  by character name.
- Name-fix list: "Rectaungular" again (G333170).

**Batch 17 (2026-10-28, applied: 29 live, 479 in all).** The file is
`data/description-batch-17.csv`. 29 audit rows were matched against the
live text (2,975 characters), and the live prod-00933 page was checked.
S162757 got no description (blurry); add it to the bad-photo exclusions.

- **Better logging order, use from now on:** write the `audit_log` rows
  *before* the apply, with `old_value = p.description` read in the same
  INSERT and `new_value` the proposed text (dollar-quoted `$d$...$d$`).
  Afterwards check `products.description = audit_log.new_value` for every
  row. This keeps exact old text even when it isn't name + "/cs": F287104
  and F287110 ended "cs.36/cs", matching the label's 36/cs. Their current
  names say "cs.3pk", which looks like a later bad rename.
- **QuickBooks case counts for the 3D range look wrong:** 3D801256/57/59
  are 72/cs on the label and in the name, while QuickBooks says 12 (240 for
  3D801256). Same as 3D801255 in batch 16.
- Other case conflicts: F287438 (label and QuickBooks 80, name 72);
  F287430 (label and QuickBooks 600 pks, name cs.50pk); T641834 (name 480,
  QuickBooks 60).
- K229420's QuickBooks sales description says "Soccer Bling Keychain" for
  a heart keychain. P251933's label says 13" against the 14'' name (size
  left out).

**Batch 18 (2026-10-28, applied: 29 live, 508 in all).** The file is
`data/description-batch-18.csv`. 29 audit rows (written before the apply)
were matched against the live text (2,848 characters), and the live
prod-00182 page was checked. LL666 got no description (blurry); add it to
the bad-photo exclusions.

- **Encoding trap:** `XLSX.readFile` on a CSV decodes it as Latin-1, so
  "appliqués" came out "appliquÃ©s" in the payload. It was caught before
  anything was written, and no earlier batch had non-ASCII text (checked
  the files and audit_log). Read batch CSVs with
  `XLSX.read(fs.readFileSync(f,'utf8'),{type:'string'})`, and keep
  descriptions ASCII.
- **F287772 and F287773 share the name "Matte Light Purple Pull Flower
  Ribbon".** F287772's photo is deep purple, so its name is wrong.
- **B325097's photo label reads B425097**; it's still a belt bag, so check
  that the photo belongs to this SKU.
- Chenille again: F287656 and F287660 labels say 100 pcs/pk against 10/pk.
  F287660 "Dark Red" looks brown (colour left out).
- QuickBooks 3D-range counts again: 3D801264 (QuickBooks 216 against 60),
  D751002 (QuickBooks 48 against 96).
- P257222 "Rainbow Bear" has a horn (animal left out). P257236 "Tote Bag"
  is a paper gift bag filed under Bags/Purses.
- Name-fix list: "Sequence" for Sequin (B325069).

**Batch 19 (2026-10-28, applied: 30 live, 538 in all).** The file is
`data/description-batch-19.csv`. 30 audit rows (written before the apply)
were matched against the live text (3,174 characters), and the live
prod-40557 page was checked. Every photo was usable. Three newer products
(prod-40557, prod-40648, prod-40531) had blank descriptions rather than
name copies; their undo restores blank.

- **Name doesn't match the photo:** B325101 "Backpack" is a handbag with
  top handles. F286921 "Purple Rose" shows pink roses (colour left out).
  F287969 "BLACK" shows white, black and pink sets.
- **Case counts:** F287691 and F287692 (label and QuickBooks 200, name 192),
  P257237 (label and QuickBooks 50, name 48), P273648-40cm (label and
  QuickBooks 12, name 24), D751077 (label 192, name and QuickBooks 96).
- P273676-100cm: label 32" against 100cm in the name (size left out).
- Name-fix list: P273676-L 12' (feet), "See-Though" (B325105), "Flora" for
  Floral (F286938), "Mall" probably Small (T642285).

**Batch 20 (2026-10-28, applied: 30 live, 568 in all).** The file is
`data/description-batch-20.csv`. 30 audit rows (written before the apply)
were matched against the live text (2,963 characters), and the live
prod-01469 page was checked. Every photo was usable. Three had older name
copies (prod-00636, prod-00337, prod-00568), and their exact text is in the
audit rows and the log.

- **Name doesn't match the photo (left out):** S146893 "Squirrel" looks
  like a chick. P257260 "Heart Puppy" looks like a bear or cat. F287792
  "Butterfly Print" shows birds and hearts. F286940 "Red And Peach" shows
  hot and light pink. FD250019 "Light Green" is mid green.
- S146927 "Mermaid Slime": the photo also shows a dinosaur display. The
  label says 72/bx x 8 = 576 against the name's cs.144.
- Case counts: F287698 (200 against 192), D751119 (240 against 192),
  T641826 (50 against 48), D751121 (QuickBooks 70 against 140). P273689's
  QuickBooks entry says 36cm and 36/cs.
- K229433's "number 5 bottle" resembles a perfume brand; it's described
  generically.
- Name-fix list: "Flora" for Floral again (F286940).

**Batch 21 (2026-10-28, applied: 30 live, 598 in all).** The file is
`data/description-batch-21.csv`. 30 audit rows (written before the apply)
were matched against the live text (2,625 characters), and the live
prod-02674 page was checked. Every photo was usable. prod-00116 and
prod-00339 had older name copies, kept exactly in the audit rows and the
log.

- **K229438's photo label reads K229430** (the bear-ear keychain), though
  it shows flower keychains.
- Case counts: F287850 and F287849 (label and QuickBooks 40, name 36),
  P257265 and P257262 (50 against 48), T641916 (label 264, name and
  QuickBooks 360).
- Sizes left out: T641667 (label 19.3", name 21"). F287863's label size
  equals the QuickBooks carton size, so it isn't the product size.
- Name-fix list: P273701 10' (feet).

**Batch 22 (2026-10-28, applied: 30 live, 628 in all).** The file is
`data/description-batch-22.csv`. 30 audit rows (written before the apply)
were matched against the live text (2,791 characters), and the live
prod-01527 page was checked. Every photo was usable.

- **Copy-detector trap:** a short description whose words all appear in
  the name ("Green flower lei." for "Solid Green Flower Lei") counts as a
  name copy under `isNameCopyDescription` and would be hidden. It was caught
  before applying, and batches 14-22 were all re-checked clean. Run every
  batch file through the same word-subset check before applying.
- **The QuickBooks sales descriptions of K229440 and K229420 are swapped:**
  the soccer ball says "Open Heart" and the heart says "Soccer".
- P273725 "Fat Cat 20'": label 13.5" (size left out); QuickBooks 12/cs
  against the label's 18.
- Case counts: S162748 (QuickBooks 24 against 36), T641923 (label 75
  against 84), T641919 (QuickBooks 48 against 24), P282115 (QuickBooks 120
  against 240), F287851 (label 40 against 36).
- K229439 is another "Brown Bear" capybara. F286983's pattern resembles a
  luxury monogram (described generically).
- Name-fix list: "Rafia" for Raffia (G333158).

**Batch 23 (2026-10-28, applied: 30 live, 658 in all).** The file is
`data/description-batch-23.csv`. 30 audit rows (written before the apply)
were matched against the live text (2,970 characters), and the live
prod-02056 page was checked. Every photo was usable, and every description
passed the copy check.

- F286984 and F286983 share the name "5 leaf Plastic Floral Paper" (one
  white, one black).
- P273740 "in Deer Hoodie" shows a pineapple-like hood (hoodie animal left
  out). S162759 is another "Brown Bear" capybara.
- Case counts: T642071 (QuickBooks 192 against 156), F287855 (label and
  QuickBooks 50 against 48). P256993's name inverts its pack layout (18/pk
  40bx; really 40 per display x 18).
- H424183's headbands carry a brand-like embroidered name, left out.

**Progress 2026-10-28:** 658 of 1,183 visible products have a real
description, and 525 remain.

**Name fixes from the batches, applied 2026-10-27.** 13 renames went
through `fix-product-names.ts --plan=data/product-name-fixes-typos-20261027.csv`.
The plan was built from live names, with one exact substring fix per row.
Erply, Woo and Supabase were all verified, and the names were read back.
Fixed:

- typos: Dumping (S121034-G), Harbrushes (H424269, H424268), Myster
  (3D801162), Pluses (P273756), Fuffly (P273766), Footbal (T641963, plus
  the repeated "40oz"), Silione (K229367), Diamon (F287074), Desert to
  Dessert (B325102);
- the truncated F287835 (full name taken from QuickBooks);
- feet for inches on D701045-White (47.2' to 47.2");
- leftover "180 ea/sc" (F287074) and "1000 ea/..." (F287570).

The Woo guard skipped F287570 because its Woo name already differed. So
the typo bullets in the batch sections above are now **fixed**. Still open,
because they need a decision rather than a typo fix: P273766 "Sneaker"
(the photo shows slippers), "Brown Bear" to capybara, the "Hair Clipper
Set" (hair clips), IC44200's category, and every pack or case-count
conflict. The flag rate fell from 12-17 per batch to 4-7
as the batches reached newer photos with clear labels.
