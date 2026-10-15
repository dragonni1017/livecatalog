---
name: project-carton-name-fixes-20261013
description: 2026-10-13 renamed the 108 live products whose names were raw QuickBooks descriptions (carton dims/weight in the name) in Erply, Woo and Supabase; pack specs deliberately left as they were, several are questionable
type: project
---

The 108 SKUs in `data/broken-product-names-20261006.csv` had raw QuickBooks
descriptions as their names, e.g. `Glass Flower Vase - 30/cs - 23" x 14" x 15"
- 30lbs - 30/pk 1bx/cs cs.30`. They were renamed 2026-10-13 with
`scripts/plan-carton-name-fixes.ts`, which writes
`data/product-name-fixes-plan-carton.csv`, and then
`scripts/fix-product-names.ts --plan=... --apply`. The log is
`data/product-name-fixes-applied-carton-20261013.csv` (T642288 hit a transient Erply
"fetch failed" and was re-run with --only; all 108 done).

- **Cosmetic only.** The base was cleaned with `descriptorFromQbDesc`. The pack
  spec was copied character for character. Names with no spec kept their QB
  case count (`- 60pk/cs`), so their only pack information wasn't lost.
- **4 SKUs are Woo-only and not in Erply:** F286459-Fu, F286459-R, F287279-Pp
  and F287279-R. Only Supabase was renamed for them. Their Woo names use the
  older `SKU - name` format, so the guard skipped them and they still carry
  the carton text on Woo. The Woo webhook only handles orders, so the
  Supabase rename sticks.

**Not fixed, needs a human:**
- About 50 specs are still the receiving placeholder `N/pk 1bx/cs cs.N`,
  with the whole QB case treated as one pack.
  FLORAL PAPERS FIXED 2026-10-13: 22 papers (18 of them `60/pk 1bx/cs cs.60`,
  plus CM072310, F288081, F288082 and F288090, which had no spec) are now
  `20/pk 60bx/cs cs.60` pack-sold in Erply, Woo and Supabase.
  `scripts/plan-floral-paper-pack-fixes.ts` produced the change; the log is
  `data/product-name-fixes-applied-floral-paper-20261013.csv`. QB says 60pk/cs,
  and the confirmed rule is 20 sheets/pack. All 22 were hidden at $0 and a
  case is still 60 units, so neither prices nor stock needed changing.
  F288118 Newspaper Bouquet Wrap was left out: QB says `60/cs`, so it's open.
  MOONRISE PAPERS FIXED 2026-10-15: F287948-F287957 had no spec and are now
  `20/pk 60bx/cs cs.60` pack-sold. The supplier's 2026-04 ETD 0417 1078ctn
  Original List states `bx`=20 and `bx/cs`=60 outright.
  `scripts/plan-moonrise-paper-pack-fixes.ts` made the change. Woo kept the
  older `SKU - name` form, so it needed a second plan whose expect is Woo's
  live name (`...-moonrise-paper-woo.csv`): the guard makes Erply/Supabase
  "already correct" on that pass. Logs are
  `data/product-name-fixes-applied-moonrise-paper[-woo]-20261015.csv`.
  (Woo's F287957 is resolved; see the Woo name mismatches below.) Prices run from $1.25 to $10.25 across the 10
  colours and now read per 20-sheet pack; that is unresolved, and not ours
  to set.
  26 MORE PAPERS FIXED 2026-10-15. The supplier documents gave 60/carton with
  no pack column (7 say 20张/包 in 品名). Dragon confirmed they follow the
  same rule, so they are now `20/pk 60bx/cs cs.60`.
  `scripts/plan-floral-paper-60cs-pack-fixes.ts` made the change, again with a
  second Woo plan. Erply and Supabase are 26/26, Woo 24/26.
  The 3 other 60/carton items (F288016 basket, P273854 plush, T642285 fan)
  aren't paper and weren't touched.
  WOO NAME MISMATCHES (F287957, F287826, F287984), checked 2026-10-15. All
  three Woo products are unpublished drafts from a 2026-07-23 bulk import
  (no price, Uncategorized). Each one's photo is identical to the catalog's,
  with SKU and UPC printed on it, and the UPCs match the supplier's 2026-05
  1297ctn Original List. So these are the SAME products under different
  names, not different products.
  - F287957 and F287984: Woo renamed to Erply's name
    (`data/product-name-fixes-plan-woo-name-mismatch.csv`).
  - **F287826 is still open, and Erply's name is the likely error.** The
    photo is plainly taupe/greige, and Woo's independent import also says
    "Taupe". Erply and the catalog say "Light Green Solid Color Paper".
    Dragon chose to leave it until someone checks the physical paper; then
    rename Erply, Woo and Supabase together.
  Also: the 2020 UPC assignment file has an OLDER F287957 family
  (-Bl/-Blue/-Pk/-R, UPCs 6814023931xx), so that SKU was reused. The
  current product's UPC is 737879105825.
- 6 names still have no pack spec: K229581, P273839-60cm, P273863-110cm,
  P273863-90cm, T642212 and T642288.
- QB typos were left as written: Cirlce (F288022), Ballon (D701141), and
  "Christmas Three in Dome" (F286555, probably Tree). FD400033/FD400038 lack
  the word "Ribbon".
- F287279-B/-Pp/-R carton figures were the box's own size, 7x23x17 cm.
  FIXED 2026-10-13. Erply -B's L/W/H were set to 0. Woo -Pp/-R went from
  17.78x58.42x43.18 (the size x2.54) to 7x23x17. Woo's unit setting is cm, so
  that matches -B, which was left alone. Supabase case_* and
  measurements_source were nulled, which puts all three on the measurement
  worklist. `backfill-product-measurements.mjs` now skips them
  (NOT_A_CARTON), because it reads Woo's cm as carton inches. **The real
  18-box carton still needs a tape measure.**
