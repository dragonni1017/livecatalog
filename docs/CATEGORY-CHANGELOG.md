# Category Changelog

Tracks every change made to `categories`/`products.category_id` in Supabase (project `aguorduaxfqrvvywgrdi`) to align the live catalog with **"2026 Category Product List for ERPLY and Netsuite Website Official 2026.xlsx"**.

Baseline before any change: 61 categories, 3,016 products, 0 orphaned products.

---

## PROPOSED — pending Dragon's approval (not yet run)

### 1. Duplicate / typo categories (8 cases)

| # | Current name(s) | Products | Action | Final name | Slug kept |
|---|---|---|---|---|---|
| 1 | Tumbler (162) + Tumblers (3) | 165 | Merge — delete "Tumblers" row, repoint its 3 products | **Tumblers** | `tumbler` |
| 2 | Crochets (28) | 28 | Rename only, no second row | **Crochet** | `crochets` |
| 3 | Crown (11) | 11 | Rename only, no second row | **Crowns** | `crown` |
| 4 | Floral Basket (51) + Floral Baskets (2) | 53 | Merge — delete "Floral Baskets" row, repoint 2 products | **Floral Basket** | `floral-basket` |
| 5 | Floral Supplies (175) + Flower Supplies (4) | 179 | Merge — delete "Flower Supplies" row, repoint 4 products | **Floral Supplies** | `floral-supplies` |
| 6 | Picture Frames (28) + Photo Frames (1) | 29 | Merge — delete "Photo Frames" row, repoint 1 product | **Picture Frames** | `picture-frames` |
| 7 | Stationary Supplies (5) + Staionary Supplies (1, typo) | 6 | Merge — delete "Staionary Supplies" row, repoint 1 product | **Stationary Supplies** | `stationary-supplies` |
| 8 | LED/Electronics (40) + LED/Electronic (3, typo) | — | Merge first, then redistributed — see §2 | **LED/Electronics** | `led-electronics` |

Slugs are kept stable (no URL/SEO breakage) even where the display name changes.

### 2. Catch-all categories — best-effort auto-sort by product name keywords

These 4 categories were named after the official list's top-level group headers rather than a specific subcategory. 170 products reviewed (167 + 3 from the LED/Electronic typo merge above); 69 have an unambiguous keyword match and move, the rest stay put.

| Source category | Reviewed | Moved | Stayed (flagged below) |
|---|---|---|---|
| Toys (96) | 96 | 11 | 85 |
| LED/Electronics (40 + 3 typo) | 43 | 38 | 5 |
| Seasonal Items (26) | 26 | 17 | 9 |
| Drinkware (5) | 5 | 2 | 3 |

**Moves (new/target category ← from):**
- **Speakers** (new) ← 15 products: all explicit "Speaker(s)" items, e.g. *Boombox Speaker 30", G Shaped Bluetooth Speaker, Karaoke System w/ Speaker, Sound Bar Multicolor Bluetooth Speaker 13"*
- **LED** (existing, 2→23) ← 21 products: explicit "LED [animal/shape]" items with no stronger match, e.g. *LED Bear w/ Heart, LED Dolphin, LED Elephant, LED Turtle 15", LED Unicorn w/ Bluetooth 30cm, Marry Me LED 24"*
- **Lamps** (existing, 31→33) ← 2 products: *LED Jellyfish Lamp Large, LED Projector Lamp*
- **Dome** (existing, 44→45) ← 1 product: *Purple Galaxy Flower Dome w/ Bear USB*
- **Christmas** (new) ← 14 products: e.g. *25" LED Christmas Tree with Star Top, Christmas Projector, Giant LED Reindeer 38", Reindeer Cozy Holiday Socks*
- **Wreaths** (new) ← 3 products: *Merry Christmas Wreaths, Reindeer Christmas Wreaths, Smiley Rabbit Christmas Wreaths*
- **Plate Set** (new) ← 2 products: *Baby Dino 3D Bamboo Dinnerware 5 Piece Set, Bamboo Dinosaur Single Plate*
- **Fidgets** (existing, 18→22) ← 4 products: *A.U Simple Dimple, Infiniti Cube, Spinning Cube with Poppers, Wacky Track*
- **Squishy / Slime** (existing, 107→109) ← 2 products: *Colorful Slime Bottles with Metal Cap, Dino Squish Toy*
- **Fan** (existing, 28→30) ← 2 products: *Dinosaur Spray Fan, Unicorn Spray Fan*
- **Sticks Toys** (existing, 16→19) ← 3 products: *DIY Glow Stick Party Pack (x2), Glow Sticks Mix*

**Flagged — left in place, no confident subcategory match (101 products):** mostly dinosaur/animal light-and-sound figures, balloons, bounce toys, blister-pack pretend-play sets, and novelty items with no corresponding leaf in the official list. A few are worth a manual look because they appear to be the wrong *top-level* group entirely (left untouched — cross-group moves need your judgment, not a keyword guess):
- *Graduation Bear Ceramic Cup* (Toys) → looks like Drinkware/Ceramic Cups
- *Children's Foldable Chair Cow* & *Children's Foldable Chair Sports* (Toys) → look like General Merchandise/Chairs
- *Baby Dinosaur Highlighter* (Toys) → looks like General Merchandise/Stationary Supplies (Pens)
- *Turquoise Floral Decor Paper Roll* (Toys) → looks like Florals/Gifts/Papers
- *Star Milky Way Galaxy Room Projector w/ Remote Control* (Toys) → looks like LED/Electronics/Lamps
- *Unicorn Popper Wireless Headphones* (LED/Electronic typo merge) → no clean fit anywhere

### 3. New empty categories (8) — created ahead of products being assigned to them

Backpack (go with bag/purse), Hair Dryers, Cosmetic Bags, Pencils, Gifts, Humidifier, Signs/Animals, New Arrivals.

### Net effect

- Categories: 61 → 67 (−6 deleted duplicates, +12 new)
- Products: 3,016 total, unchanged — only `category_id` moves between existing categories
- Slugs: zero breaking changes (every kept category retains its current slug)

---

## EXECUTED — 2026-06-22

Ran exactly as proposed above, with Dragon's approval (incl. the auto-sort step). Verified after running:

- Categories: 61 → **67** (confirmed)
- Products: **3,016** (unchanged) / **0** orphaned (every product still has a valid `category_id`)
- Final counts for every touched category matched the plan exactly — see table below.

| Category | Final product count |
|---|---|
| Tumbler (displays as "Tumblers") | 165 |
| Crochet | 28 |
| Crowns | 11 |
| Floral Basket | 53 |
| Floral Supplies | 179 |
| Picture Frames | 29 |
| Stationary Supplies | 6 |
| LED/Electronics | 4 |
| LED | 23 |
| Dome | 45 |
| Lamps | 33 |
| Speakers (new) | 15 |
| Christmas (new) | 14 |
| Wreaths (new) | 3 |
| Plate Set (new) | 2 |
| Fidgets | 22 |
| Squishy / Slime | 109 |
| Fan | 30 |
| Sticks Toys | 19 |
| Drinkware (catch-all remainder) | 3 |
| Toys (catch-all remainder) | 85 |
| Seasonal Items (catch-all remainder) | 9 |
| Backpack (go with bag/purse) (new, empty) | 0 |
| Hair Dryers (new, empty) | 0 |
| Cosmetic Bags (new, empty) | 0 |
| Pencils (new, empty) | 0 |
| Gifts (new, empty) | 0 |
| Humidifier (new, empty) | 0 |
| Signs/Animals (new, empty) | 0 |
| New Arrivals (new, empty) | 0 |

Cross-group items flagged in the plan (Graduation Bear Ceramic Cup, Children's Foldable Chair Cow/Sports, Baby Dinosaur Highlighter, Turquoise Floral Decor Paper Roll, Star Milky Way Galaxy Room Projector, Unicorn Popper Wireless Headphones) were **left untouched** as noted — still worth a manual look.

---

## EXECUTED — 2026-06-22 (later)

Merged the placeholder **"Backpack (go with bag/purse)"** (`cat-066`, slug `backpack`) into **"Bags/Purses"** (`cat-003`, slug `bags-purses`), per Dragon's request to make Bags/Purses the main one. The backpack category was empty (0 products, as recorded above), so this was a clean delete:

- Reassigned any `cat-066` products to `cat-003` — **0 moved** (none existed).
- Deleted the `cat-066` row.
- Categories: 67 → **66**. Products: **3,016** unchanged / **0** orphaned.
- Bags/Purses (`cat-003`) product count: **134** (unchanged).

---

## EXECUTED — 2026-06-23

Resolving the 6 cross-group items flagged on 2026-06-22 as needing manual judgment (not a keyword guess). Each was checked against existing sibling products in its candidate destination category before moving, one iteration at a time, per Dragon's approval to apply all 6 in this pass.

### Iteration 1 — Graduation Bear Ceramic Cup
- SKU `T641730`. Moved **Toys** (`cat-058`) → **Ceramic Cups** (`cat-011`).
- Rationale: exact category-name match for a ceramic cup product; no reason to keep it in the Toys catch-all.
- Ceramic Cups: 11 → **12**.

### Iteration 2 — Children's Foldable Chair Cow
- SKU `T641565`. Moved **Toys** (`cat-058`) → **Chairs** (`cat-012`).
- Rationale: three siblings in the same product line (Monkey, Rainbow, Unicorn) were already in Chairs — Cow and Sports were the only two left behind in Toys.
- Chairs: 3 → **5** (after both iterations 2 and 3).

### Iteration 3 — Children's Foldable Chair Sports
- SKU `T641477`. Moved **Toys** (`cat-058`) → **Chairs** (`cat-012`).
- Rationale: same product line as Iteration 2.

### Iteration 4 — Baby Dinosaur Highlighter
- SKU `P257127`. Moved **Toys** (`cat-058`) → **Stationary Supplies** (`cat-056`).
- Rationale: two other highlighters (Avocado Highlighter, Baby Octopus Highlighter) already live in Stationary Supplies — a closer match than the originally-proposed "Pens" category, which has no other highlighters.
- Stationary Supplies: 6 → **7**.

### Iteration 5 — Turquoise Floral Decor Paper Roll
- SKU `F286963`. Moved **Toys** (`cat-058`) → **Papers** (`cat-042`).
- Rationale: 5 of its 6 color siblings (Black, Blush Pink ×2, Red, Royal Blue, White Floral Decor Paper) are already in Papers; only Brown sits in Floral Supplies. Majority sibling match wins.
- Papers: 374 → **375**.

### Iteration 6 — Star Milky Way Galaxy Room Projector w/ Remote Control
- SKU `T641851`. Moved **Toys** (`cat-058`) → **Lamps** (`cat-037`).
- Rationale: Lamps already holds several "LED Projector Lamp" siblings (Dinosaur, American Eagle, Bear, Ninja, Unicorn, I Love You) plus "Moon and Stars Light Projector and Speaker" — a direct fit.
- Lamps: 33 → **34**.

### Iteration 7 — Unicorn Popper Wireless Headphones — no move
- SKU `T641415`. **Left in LED/Electronics** (`cat-036`), not Toys as the 2026-06-22 note implied.
- Rationale: it already sits next to "Head Phone," another headphones product — the existing placement is correct. The earlier "no clean fit anywhere" flag appears to have been written before checking siblings; confirmed with Dragon and no change made.
- LED/Electronics: **4** (unchanged).

### Net effect
- Categories: 66 (unchanged — no categories added/removed this pass).
- Products: **3,016** (unchanged) / **0** orphaned (verified via `products` LEFT JOIN `categories`).
- Toys (catch-all remainder): 85 → **79** (the 6 moved out; Iteration 7 stayed elsewhere, not Toys, so it doesn't subtract from this count).

All 6 originally-flagged items are now resolved — no open cross-group placements remain from the 2026-06-22 pass.

---

## EXECUTED — 2026-06-23 (later) — Populating empty categories

Searched the full catalog by keyword for products that belong in the 8 new categories created empty on 2026-06-22. Findings and actions below; Dragon chose to act on Hair Dryers, Cosmetic Bags, and Humidifier this pass and defer Pencils/Signs-Animals/New Arrivals/Gifts.

### Iteration 8 — Hair Dryers
- SKU `T641996` "Leafless Hair Dryer." Moved **Beauty Supplies** (`cat-005`) → **Hair Dryers** (`cat-067`).
- Rationale: only hair dryer product in the whole catalog; exact match for the new category.
- Hair Dryers: 0 → **1**. Beauty Supplies: 21 → 19 (after this + Iteration 9's 2 Beauty Supplies items, net 18).

### Iteration 9 — Cosmetic Bags
- 6 SKUs moved into **Cosmetic Bags** (`cat-068`): `P282115` Butterfly Makeup Bag, `P282113` Cat Makeup Bag, `P282119` Five Piece Makeup Bag, `C801001` Three Piece Zebra Print Clear Makeup Bags (all from **Bags/Purses**, `cat-003`); `C801015` Fruity Wristlet Cosmetic Bag, `C801003` Three Piece Rectangle Clear Makeup Bag Combo Set (both from **Beauty Supplies**, `cat-005`).
- Rationale: every product with "makeup bag" or "cosmetic bag" in its name, regardless of which catch-all it had been sitting in — consolidated into the purpose-built category.
- Cosmetic Bags: 0 → **6**. Bags/Purses: 134 → **130**. Beauty Supplies: 21 → **18** (combined with Iteration 8).

### Still open from the empty-category review
- **Pencils** — no standalone pencil product exists in the catalog (only pencils-with-eraser, sharpeners, and pencil cases, already living in Erasers/Sharpeners/Pens/Stationary Supplies/Bags/Purses). Deferred — likely stays empty barring new inventory.
- **Signs/Animals** — zero products match "sign" anywhere in the catalog. Deferred.
- **New Arrivals** — `products` table has no creation-date column (only `updated_at`, touched by every sync), so this can't be populated by keyword or recency. Deferred pending a schema/process decision.
- **Gifts** — scope unclear given "Gift Bags" (`cat-030`, 125 products) already exists. Deferred pending Dragon's definition of what's meant to live here.
### Iteration 10 — Humidifier
- 3 SKUs moved into **Humidifier** (`cat-071`): `T642124` Clam Humidifier Lamp, `T642122` Dolphin Humidifier Lamp, `T642123` Jellyfish Humidifier Lamp — all from **Lamps** (`cat-037`).
- Rationale: Dragon's call — "Humidifier" treated as the more distinctive function for these lamp/humidifier hybrids, overriding the original Lamps placement.
- Humidifier: 0 → **3**. Lamps: 34 → **31**.

### Gifts — investigated, mostly deferred
- Dragon defined Gifts as general/assorted gift items, explicitly **not** packaging (gift boxes, bows, bags).
- Keyword search for "gift" (excluding "gift bag") returned 76 products, but ~98% of them are gift boxes, gift bows, or a gift basket — i.e. packaging/supplies, which Dragon's own definition excludes. Scattered across Bags/Purses, Bows, Floral Basket, Floral Boxes, Flowers, Gift Bags, Papers, Ribbons.
- Only one real candidate matched the "actual gift item, not packaging" definition: `F286575` "Soap Rose and towel bear combo gift set" (currently in Floral Boxes) — a bundled product, not a box. Holding this for Dragon's confirmation before moving.
- No other action taken — moving the 75 gift-box/bow/basket products would contradict the stated scope.

### Iteration 11 — Gifts
- SKU `F286575` "Soap Rose and towel bear combo gift set." Moved **Floral Boxes** (`cat-023`) → **Gifts** (`cat-070`).
- Rationale: Dragon confirmed — it's a bundled combo product, not packaging, matching the "general/assorted gift items" definition.
- Gifts: 0 → **1**. Floral Boxes: 153 → **152**.

### Net effect (this section)
- Products: **3,016** unchanged / **0** orphaned, verified after every move.
- Still empty / deferred: Pencils, Signs/Animals, New Arrivals (see reasons above).

---

## EXECUTED — 2026-06-25 — High-confidence category consolidation

Merged the 4 "High confidence" groups from `livecatalog-category-breakdown.xlsx` (Merge Suggestions sheet). Each group's survivor category was the largest member by product count, kept on its existing `id`/`slug` (zero URL/SEO breakage), renamed to the broader group name, then the other members' products were repointed and the now-empty member rows deleted. Ran inside a single `BEGIN…COMMIT` transaction.

**Full pre-merge snapshot (all 20 source categories + the exact `product_id → old_category_id` mapping for all 792 affected products) saved to** `docs/category-merge-backups/2026-06-25-merge-backup.json` — use it to revert exactly if needed (see Revert section below).

| New category | Survivor row (id / slug) | Absorbed (deleted) | Final count |
|---|---|---|---|
| **Drinkware & Cups** | cat-059 / `tumbler` | Ceramic Cups (12), Drinkware (3), Plastic Cups (1), Speaker Cups (10) | 191 |
| **Stationery & Office** | cat-043 / `pens` | Notebooks (37), Erasers (30), Sharpeners (8), Stationary Supplies (7), Pencils (0) | 164 |
| **Toys & Novelties** | cat-047 / `plush-toys` | Toys (79), Squishy/Slime (109), Sticks Toys (19), Fidgets (22), Bubbles (22) | 411 |
| **Seasonal & Holiday** | cat-064 / `christmas` | Wreaths (3), Seasonal Items (9) | 26 |

Verified after running:
- Categories: 66 → **50** (16 rows deleted: 4+5+5+2 across the four groups).
- Products: **3,016** unchanged / **0** orphaned (every product still has a valid `category_id`).
- All four survivor categories' final counts matched the plan exactly (table above).
- Confirmed no other table has a foreign key into `categories` besides `products.category_id`, so the deletes were safe.

**Not touched this pass** (left exactly as-is, per the breakdown's own caveats — review before merging):
- *Floral & Flower Decor*, *Gift Packaging & Wrap* (Ribbons sample SKUs look mis-tagged as gift boxes, not ribbon — audit first), *Lighting & Electronics* (Dome mixes LED decor with flower-in-dome products — needs splitting first), *Accessories & Apparel*, *Beauty & Personal Care* — all "Medium confidence" in the breakdown.
- *Signs/Animals*, *New Arrivals* — still 0 products, still flagged as delete/remove candidates rather than merge candidates; no action taken.

### Revert instructions
To undo this pass exactly, using `docs/category-merge-backups/2026-06-25-merge-backup.json`:
1. Re-insert the 16 deleted rows from `categories_before` (only the ones not equal to a surviving id: all except cat-059, cat-043, cat-047, cat-064).
2. For every entry in `products_before`, run `UPDATE products SET category_id = '<old_category_id>' WHERE id = '<id>'`.
3. Rename the 4 survivor categories back: cat-059 → "Tumbler", cat-043 → "Pens", cat-047 → "Plush Toys", cat-064 → "Christmas".

---

## EXECUTED — 2026-06-26 — Medium-confidence audit + 2 clean merges

Audited the 5 "Medium confidence" groups deferred on 2026-06-25, at the SKU level (not just category counts):

- **Floral & Flower Decor** — NOT merged. Floral Supplies (179 SKUs) has more cross-contamination than the original "pearl beads" caveat implied: a fleece blanket, plastic plates, a compact mirror, storage racks, cake toppers, thank-you cards. Needs a sub-split before merging.
- **Gift Packaging & Wrap** — NOT merged. Ribbons (179 SKUs) is mostly genuine ribbon (the "mis-tagged" caveat overstates it), but carries a real tail of ~15-20 gift boxes/baskets/unrelated SKUs that should move out first.
- **Lighting & Electronics** — NOT merged. Dome (45 SKUs): 43 are flower-in-glass decor (LED is just a feature) and only 2 are bare LED strips that aren't dome products at all. Most of Dome likely belongs in Floral, not Lighting — needs reassignment, not a straight merge.
- **Accessories & Apparel** — checked Accessories, Hair Bands, Beanies, Hats, Slippers at SKU level: clean (one stray slime-bottle SKU in Accessories, not worth blocking on). **Merged.**
- **Beauty & Personal Care** — checked Beauty Supplies, Mirrors, Hair Dryers, Cosmetic Bags at SKU level: clean. **Merged.**

Merged the 2 clean groups using the same pattern as 2026-06-25 (survivor = largest member by count, keeps its `id`/`slug`, other members repointed then deleted, single `BEGIN…COMMIT`).

**Full pre-merge snapshot (9 source categories + the exact `product_id → old_category_id` mapping for all 241 affected products) saved to** `docs/category-merge-backups/2026-06-26-merge-backup.json`.

| New category | Survivor row (id / slug) | Absorbed (deleted) | Final count |
|---|---|---|---|
| **Accessories & Apparel** | cat-052 / `slippers` | Accessories (31), Hair Bands (26), Beanies (16), Hats (3) | 137 |
| **Beauty & Personal Care** | cat-040 / `mirrors` | Beauty Supplies (18), Cosmetic Bags (6), Hair Dryers (1) | 104 |

Verified after running:
- Categories: 50 → **43** (7 rows deleted: 4+3 across the two groups).
- Products: **3,016** unchanged / **0** orphaned.
- Both survivor categories' final counts matched the plan exactly (137, 104 — table above).

**Not touched this pass** (left exactly as-is — needs sub-split work first, see audit notes above): *Floral & Flower Decor*, *Gift Packaging & Wrap*, *Lighting & Electronics*.

### Revert instructions
To undo this pass exactly, using `docs/category-merge-backups/2026-06-26-merge-backup.json`:
1. Re-insert the 7 deleted rows from `categories_before` (all except cat-052 and cat-040).
2. For every entry in `products_before`, run `UPDATE products SET category_id = '<old_category_id>' WHERE id = '<id>'`.
3. Rename the 2 survivor categories back: cat-052 → "Slippers", cat-040 → "Mirrors".
4. Re-verify: total products 3,016, 0 orphaned, categories back to 66.
