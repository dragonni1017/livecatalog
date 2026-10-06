---
name: project-qb-product-create-plan-20261001
description: 2026-10-01 dry-run plan for creating the 113 local-photo SKUs from QuickBooks; plush 1/pk rule approved by Dragon; fill-in xlsx round trip built; 118 rows still need pack spec, category or a decision; --apply built + first live SKU 2026-10-06 (scripts/apply-qb-product-create.ts)
type: project
---

Built `scripts/create-products-from-qb.ts` (DRY RUN ONLY, `--apply` exits 1 with a
TODO block). It plans products for the 113 photo SKUs in
`data/local-photo-skus-qb-match-20261001.tsv` from `qb_item_directory`, re-checking
Erply (`code=`, plus `status=ARCHIVED`) and the catalog live. Output:
`data/qb-product-create-plan-<YYYYMMDD>.csv`. Nothing is written anywhere.

Result 2026-10-01: 122 plan rows, **119 with no skip reason, 0 that now exist** in
Erply or the catalog. Name status: 102 `needs_pack_spec`, 12 `ok`, 8 `needs_review`.
Carton figures: 55 (50 explicit inches, 5 unitless+lbs). QB $0 price: 31.
Category proposed: 13. 83 rows have no categorised catalog neighbour at all.

Not obvious from the code:

- **The TSV bare `photo_sku` hides the variant names on disk.** Photos are named
  `F288023-VLT.jpg`, `P273789-45cm.jpg` and so on, so 18 suffixed QB variants
  have their own exact-named photo and are distinct products, not ambiguous
  (F288023 and F288024 are 4 colourways each). The only real conflict is
  **T642208**. QB holds a bare `Toys/Dolls:T642208` "Mini Suitecase Makeup
  Station" ($0) and `T642208-tumbler` "Flower Tumblers 4 style". The photo
  `02_Photos/images/T642208.jpg` is plainly the tumblers (L&Y label says T642208,
  20/CS, UPC 737879106143). A human still has to decide which SKU to create.
  `P273858-60cm` has no photo of its own.
- **QB almost never gives pieces-per-pack.** Only descs written like `20/pk -
  60pk/cs` or `12/pk - 15pk/cs - 180/cs` give a complete spec. The rest are
  `needs_pack_spec` and carry the normalised `N/cs`.
- **PLUSH RULE, APPROVED BY DRAGON 2026-10-01.** A plush whose QB desc states only
  `N/cs` becomes `1/pk Nbx/cs cs.N` (piece-sold, sold singly), matching
  create-missing-plush-in-erply.mjs. The test is in `plushRule()`: the word
  Plush or Plushie in the desc (or a Plush parent in the QB FullName), a bare
  `N/cs` and nothing else, and not an accessory (keychain, bag charm, cup, pen,
  bag, backpack, slipper, hat) or a leading-count set. It completed **13** rows.
  It excluded 3, which are left for a human: K229491 plush cup, K229492 keychain
  plush, and P273830 "3 Plush Grad Bears". The rule is the only case where a pk is
  supplied rather than read.
  After it, name status is 91 `needs_pack_spec`, 23 `ok`, 8 `needs_review`.
- **Erply groups are too messy to vote on** (Keychain vs Keychains, pen vs
  Pens, TOY, "Floral Papers" and "Wrapping Paper" with no catalog category).
  The script votes with catalog neighbours instead, and a name mentioning a
  different existing category vetoes the vote. That caught 6 bad neighbourhood
  calls, e.g. T642194 umbrella among Mirrors, B325119 plush among Bags, and the
  D7011xx crowns among Seasonal.
- `T642190/94/96` have only `_barcode.png` label images on disk, no product photo.
  The earlier TSV counted those as photos.
- QB typos left as written, flagged `needs_review`: Grauation, Fodable, Tumber,
  Majong, Suitecase, Unpatented (probably "Unpatterned"). `K229497` Boba Keychain
  says 40pc/cs where every sibling says 240. P257282 and P257286 copy P257281's
  `25x25x25 42lbs` carton exactly.
- The plan inserts with **no `id`**, relying on `products_id_seq` (0052). Measurements
  would be stamped `manual` with `measurements_updated_by=qb-desc:<SKU>`, the
  P257281 precedent. qb_item_directory has no barcode, so `code2` is not sent.

**Fill-in round trip (2026-10-01).** `scripts/build-qb-product-fill-sheet.ts`
writes `data/qb-product-fill-in-<YYYYMMDD>.xlsx` from the plan CSV. It has one row
for each of the **118 of 122** planned SKUs that are not complete; only 4 were
complete. The sheet has a Fill In tab, plus Instructions, Categories and Summary
tabs. `scripts/import-qb-product-fill-sheet.ts` is DRY RUN only. It validates the
sheet, rebuilds names with buildProductName + auditProductName, and writes
`...-from-fill.csv`. On the blank sheet it reports 4 ready, 116 incomplete
(category 107, pieces per pack 94, sold by 94, packs per case 87) and 2 errors
(the T642208 pair is undecided).
- **xlsx 0.18 (community) cannot write data validation**, so there is no
  category dropdown. The Categories tab plus import-time name checking does that
  job instead.
- Typo fixes are PREFILLED in "Name override" and applied on import unless the
  cell is cleared, and the row notes say so.
- Pack figures that conflict with the QB desc are an ERROR, not an override.
  QB is the source, so fix QB first (this matters for K229497's 40-vs-240).

**--apply built 2026-10-06:** `scripts/apply-qb-product-create.ts` reads the
importer's `-from-fill.csv` (`ready` rows only) and refuses to run if the fill
sheet was saved after that CSV. It creates each SKU in Erply through
lib/erply.ts createErplyProduct, reads it back, then inserts one catalog row per
call (no `id`, hidden, $0), and STOPS on a products_pkey collision (re-run 0052,
then re-run the script, which resumes an Erply-created SKU that is missing from
the catalog). Its log is `data/qb-product-create-applied-<date>.csv`. Photos are
NOT uploaded: it prints `upload-container-photos.ts --dir` commands instead. These
SKUs are outside zero-price-visibility's receiving cohort, so unhide them with
`--include-sku`. A dry run on the blank sheet shows 4 ready. P257282/P257286 are
among them and still carry P257281's copied carton figures (see above).
FIRST LIVE RUN 2026-10-06: P273796-25cm (Corgi plush) -> Erply #3171, catalog
prod-87243, hidden at $0, photo uploaded; still needs its price in Erply, then
an unhide. Its label photo shows UPC 737879103203, so label photos are a possible
barcode source (code2 is not sent today).
All 4 ready rows DONE 2026-10-06, each with its photo uploaded, all hidden at $0
awaiting Erply prices: P273796-25cm #3171, P273817-25cm #3172, P257282 #3173,
P257286 #3174. The 25x25x25 42lbs is in QUICKBOOKS ITSELF for P257281/82/86, not
a planner copy. P257282 (giant fur pen, same 12x24=288 packing as P257281) kept
it. P257286 is a 5.9in pen packed 24x16=384, so the figure is almost certainly
cloned in QB: it was created with --no-case (no carton stored, so it is on the
measurement worklist), and its QB desc still needs fixing. P257281 own figure is
legacy-name, not tape-measured.

**Still outstanding:** someone has to fill the sheet (pack specs, about 107
categories, the T642208 choice) and price the products by hand in Erply.
See [[project-local-photos-skus-not-in-erply]], [[project-qb-item-pull]] and
[[project-receiving-to-catalog-20260923]].
