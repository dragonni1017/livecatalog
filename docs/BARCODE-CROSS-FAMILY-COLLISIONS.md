# Barcode cross-family collisions — needs physical verification

Found 2026-07-30 while reconciling `products.barcode` against Erply's product
codes. 41 barcodes in the live catalog are shared by SKUs that are **not**
color/size variants of the same item (unlike the ~62 other duplicate-barcode
groups, which are legitimately one UPC covering a whole color family — those
don't need fixing). These 41 look like real data errors: two unrelated
products carrying the same barcode. Full source data (all groups, including
the legitimate ones) is in `duplicate-barcode-families.csv` from the same
session.

**Updated 2026-08-18**: reviewed the remaining ~56 duplicate-barcode groups
that had never been individually checked (see
`docs/memory/project-duplicate-barcode-families.md` for the methodology and
what it did/didn't catch). Found 15 more cross-family collisions of the same
kind — see the new section below. The total is now 56, not 41 (the doc title
below is kept as the original count for history; treat 56 as current).

None of these can be fixed from the database — there's no way to tell from
Supabase or Erply alone which SKU has the *correct* barcode. Someone needs to
check the physical product/packaging (or the original supplier invoice) for
each pair and correct the wrong one. This doc is a checklist for that.

## Three systematic patterns (fix these as a batch, not one-by-one)

These aren't random — the same two product lines keep colliding, which
suggests a single mapping error during import (e.g. two spreadsheet columns
got misaligned) rather than 11 separate mistakes.

**DIY Pearl Beads ↔ Pull Flower Ribbon** — all 6 pearl bead SKUs collide with
all 6 ribbon SKUs, one-to-one:

| Barcode | Pearl Beads SKU | Ribbon SKU |
|---|---|---|
| 737879096840 | D701108 (8mm White) | F287564 (Shiny Pink) |
| 737879096857 | D701109 (8mm Beige) | F287565 (Shiny Silver) |
| 737879096864 | D701110 (10mm White) | F287566 (Shiny Blue) |
| 737879096871 | D701111 (10mm Beige) | F287567 (Pink Heart-Pattern) |
| 737879096888 | D701112 (3mm&8mm Iridescent) | F287568 (Red Heart-Pattern) |
| 737879096895 | D701113 (3mm&8mm Beige) | F287569 (White Heart-Pattern) |

**Rectangular Compact Mirror ↔ Ribbon/Decor Clip** — 6 mirror SKUs, each
colliding with a different small-item SKU:

| Barcode | Mirror SKU | Other SKU |
|---|---|---|
| 737879096789 | T642145 (Elephant Print) | D701117 (Glittery Butterfly Decor Clips) |
| 737879096796 | T642146 (Handbag Print) | D701118 (Colorful Bird Decor Clips) |
| 737879096802 | T642147 (Perfume Print) | F287560 (Matte Silver Pull Flower Ribbon) |
| 737879096819 | T642148 (Strawberry-Themed) | F287561 (Shiny Plum Pull Flower Ribbon) |
| 737879096826 | T642149 (Butterfly Print) | F287562 (Shiny Gold Pull Flower Ribbon) |
| 737879096833 | LB1323 (Smiley Rabbit) | F287563 (Shiny Red Pull Flower Ribbon) |

**Floral Paper cross-pattern pairs** — genuinely different paper
designs/colors sharing a barcode (not the same paper in two colors):

| Barcode | SKU A | SKU B |
|---|---|---|
| 737879073087 | F286697 (White w/ Gold Edge) | F286700 (Baby Blue w/ Gold Edge) |
| 737879073094 | F286698 (Dark Purple w/ Gold Edge) | F286701 (White w/ Black Trim) |
| 737879073100 | F286699 (Pink w/ Gold Edge) | F286702 (Light Pink w/ Black Trim) |
| 737879098271 | F287554 (Green Snowflake) | F287634 (Pink Little Hearts) |
| 737879098288 | F287555 (Red Christmas Tree) | F287635 (Black Little Hearts) |
| 737879098295 | F287639 (Green Christmas Tree) | F287636 (Red Little Hearts) |

## Remaining one-off collisions (24 groups)

No obvious shared pattern between these — check each independently. A few
(`D701031`/`D701030`, `F286493-BK`/`F286501-BLK`) look like they *might* be
the same physical item under two different base codes, similar to the
already-fixed F286606 duplicate, but that's a guess, not confirmed the way
F286606 was (identical barcode + identical Erply-matching casing on one
side). Don't assume; verify.

| Barcode | SKUs |
|---|---|
| 737879084670 | T642005C (Unicorn Purse Makeup) + T642005 (30oz Two-way Drink Cup) |
| 737879075876 | T641920 (3D Printed Octopus) + T641921 (3D Printed Large Axolotl) |
| 681402394746 | T641055 (Avocado Mini Speaker) + T641275 (Avocado Small Fan) |
| 681402394517 | S129443 (Reverse Squishy) + P257091 (Multicolor Animal Pen) |
| 737879077122 | D701031 (Crown, cs.240) + D701030 (Crown, cs.20) |
| 737879089385 | F287279R + F287279-Pp + F287279-B + F287279 + F287279-R (mixed Heart Box variants + one "Red Glitter Ribbon" that doesn't belong; also note F287279R / F287279-R look like the same red heart box listed twice) |
| 737879074497 | F287417 (Red Rose Box) + F286757 (Pearl White Ruffled Floral Wrapper) |
| 737879070185 | T641664 (3D Winged Dragon) + D751059 (3D Printed Flower Frogs) + T641664-Red (Rainbow Winged Dragon) |
| 737879071311 | T641730 (Graduation Bear Ceramic Cup) + T641725 (Tie Dye Inflatable Ball) |
| 737879069677 | T641653 (LED Elephant) + T641718 (LED MOM w/ Remote) |
| 737879084656 | T642003 (Bubble Dinosaur Stick) + T642003A (White Mountable Electric Fan) |
| 737879092903 | C266028 (Animal Gummy Marshmallow Pop) + F287452 (Rectangular Flower Display Box) |
| 737879073834 | S162746 (Shaggy Clown Fish Squishy) + P257206 (DIY Beaded Round Pens) |
| 681402394500 | S162577 (Clear Squeeze Ball w/ Lights) + P250789 (Unicorn Pen w/ Rhinestones) |
| 737879071304 | T641729 (Shark Light Up Wand) + T641724 (Solid Colored Inflatable Ball) |
| 681402391615 | F286447-BLK + F282213 (Acrylic Dome Gift Box, unrelated) + F286447-PK |
| 681402394685 | F286521 (Pink LED Flower Strip) + B325015 (Cat and Tiger Backpack Mix) |
| 681402392445 | T640031 (Styracosaurus Dinosaur) + PF20200931-WT (White Floral Paper w/ Gold Trim) |
| 681402393695 | F286493-BK (Black Mom Box w/ Flowers) + F286501-BLK (Black Mom Plain Box) |
| 737879094372 | F287505 (Iridescent Floral Paper) + F287508 (Plain White Frosted Floral Paper) |
| 737879098318 | F286606-Blk + F286606-BLK (already fixed, see below) + F287638 (Green Santa Claus Wrapping Paper, still wrong) |
| 681402400201 | T641521 (Collapsible Water Bottle) + T641519 (Gummy Bear Water Bottle) |
| 737879073421 | P273670-L (White & Pink Love Bear Plush) + P273673-L (Red Love Bear Plush w/ Lights) |

## Found 2026-08-18 (15 more, same treatment as above)

Same signal as the rest of this doc — genuinely unrelated products, not
color/size variants, sharing a barcode. None fixable from Supabase/Erply
alone; needs the physical product or supplier invoice.

| Barcode | SKU A | SKU B |
|---|---|---|
| 737879101889 | 3D801227 (Large 3D Printed Lobster) | 3D801227-STARFISH (3D Printed Flexi Starfish) |
| 737879069509 | T641647 (Automatic Tri-Fold Travel Umbrella) | T641647-1 (Two in One Water Jug 64oz/32oz) |
| 681402398973 | P273581 (Graduation Bear Plush) | P273581-1 (Bear Keychain W. Love Heart) |
| 681402398775 | S162713-SD (Stegosaurus Dinosaur Mesh Ball) | S162713 (Dino Squish Toy) |
| 681402387960 | F286384-B (24K Blue Rose) | F286384-W (Rose Clear Gold Stem Light Up) |
| 681402388592 | F286411-M (Metallic Flower Without The Box) | F286411 (Iridescent Artificial Flowers with LED Lights) |
| 737879092729 | F287438-NEW (Heart Handle Iron Bucket with Lights) | F287438 (Flower Basket with Woven Rope Handle) |
| 737879094082 | F287491-BOX (3-piece Mix Color Round Glitter Box Set) | F287491 (Magic Gold Heart Ribbon Gift Box) |
| 737879101247 | F287815 (Square Shape Gift Box) | F287815-Paper (Black Solid Color Paper) |
| 737879100356 | F287753-BOUQUET (Chenille Stem Lilly Bouquet) | F287753 (Heart Shape 3-piece Gift Box Set) |
| 737879096994 | F287579-PAPER (Dark Red Ollita de Barro Floral Paper) | F287579 (Gold & Silver Wire Tie) |
| 737879067833 | T641582-1 (Mixed Unicorn Traveling Pet) | T641582 (Bamboo Cow Single Plate) |
| 737879094280 | F287497 (Glossy Red Cylindrical Gift box) | F287497-1 (3-piece Pink Heart Gift Box with Gold Outline) |
| 737879099957 | D701120-C (Reindeer Christmas Wreaths) | D701120-LB (Smiley Rabbit Christmas Wreaths) |
| 737879089361 | F287277 (Gift box) | F287277-1 (Light Pink Ribbon 1.5") |

Two more from the same review are **ambiguous, not classified either way** —
could be a near-duplicate-listing (like F286606) or a legitimate variant,
not confident enough to place in either list:
- `3D801203-SLKGLD` ("1.5M 3D Chinese Dragon") vs `3D801203-FIRE` ("1.5M
  Chinese Dragon") — barcode 737879092507
- `D751004` ("3D Printed Mystery Dragon Egg XL") vs `D751004-NEW` ("New 3D
  Printed Dragons & Eggs") — barcode 737879077689

## Already handled separately

- `F286606-Wt` / `F286606-Pk` / `F286606-BLK` — deactivated 2026-07-30, see
  [[project-duplicate-barcode-families]]. `F287638` in that same barcode
  group is still wrong (unrelated green product) and is listed above.
- `F286573-LPK` / `F286573-PK` (both "Artificial Pink Rose") — flagged as a
  likely duplicate, not yet fixed, pending confirmation.
