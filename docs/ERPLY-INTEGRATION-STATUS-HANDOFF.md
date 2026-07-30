# Erply Integration Status — Handoff (session ending 2026-07-30)

Read this first if picking up Erply/catalog-data-quality work in this repo.
Everything below happened in one session; details and evidence live in the
linked `docs/memory/` nodes — this file is the narrative summary.

## Current state

- Real Erply credentials (`ERPLY_CLIENT_CODE=552309`, `ERPLY_USERNAME`,
  `ERPLY_PASSWORD`) are now set in `.env.local`. `lib/erply.ts` will run in
  real mode, not stub mode, the next time anything calls it.
- **`app/api/sync/route.ts` has NOT been triggered for real and must not be,
  yet.** See "Do not sync yet" below — this is the most important thing to
  know.
- Erply's image API access is **not enabled** for this account yet. Dragon
  has a support contact at Erply and is requesting it be turned on; as of
  session end, not confirmed. Until it is, `getProducts`'s `images` field
  comes back completely absent (not even an empty array), regardless of
  `getImages=1`.
- Erply's own inventory is confirmed **genuinely zero** in both warehouses
  that exist on the account (warehouse 1 "L&Y USA", warehouse 2 "Store LA"),
  verified live across a 670-product sample — not a warehouse-selection bug,
  the data itself is empty. (This is the same symptom the separate,
  unrelated Erply→WooCommerce integration for ly-usa.com hit — see that
  project's own handoff doc if you have it — but confirmed here independently
  against this repo's own Erply connection.)

## Code changes made this session

`lib/erply.ts` had never been exercised against real data (only ever ran in
stub mode) and had three bugs, all fixed:

1. **Pagination undercount** — `getErplyProducts()` assumed 300
   records/page; Erply silently caps pages at 200 when `getStockInfo=1` is
   passed, so the old code would've fetched only ~2,000 of 2,870 products on
   a real sync. Fixed to loop until the accumulated count matches Erply's
   reported total, not a precomputed page count.
2. **Wrong stock field** — code read `p.amountInStock` / `p.reservedAmount`,
   neither of which exist on Erply's real response. Real shape is
   `warehouses: Record<warehouseID, {totalInStock, reserved, ...}>`. Fixed to
   sum `totalInStock` across all warehouses. (Given the finding above, this
   currently always evaluates to 0 anyway — the bug fix alone doesn't solve
   the empty-inventory problem, that needs real counts entered in Erply.)
3. **Nonexistent `isPrimary` image field** — harmless in practice
   (`.images?.[0]` is equivalent), but was reading a field Erply's docs don't
   document. Fixed, and the surrounding code comment now flags that
   `imageUrl` still needs the download-then-rehost treatment before going
   live (see next section) — it currently would hotlink Erply's URL directly
   if images were populated, which Erply's own ToS prohibits.

Full detail: [`project-erply-pagination-fix`](memory/project-erply-pagination-fix.md).

## Do not sync yet

Ran `scripts/preview-erply-sync.mjs` (new this session, read-only, writes
nothing) against the live, now-fixed code. If `app/api/sync/route.ts` were
triggered for real right now, it would:

- Correctly match all 2,870 Erply products against existing Supabase rows
  (0 inserts, 2,870 updates) — the pagination fix works.
- **Overwrite `image_url` to `null` on 1,028 products** — every product that
  currently has a working Cloudinary image — because Erply's images aren't
  accessible yet, so every incoming product's `imageUrl` resolves to `null`,
  and `product-sync.ts`'s upsert overwrites unconditionally.
- **Overwrite `stock_qty` to `0` on all 2,870 products** — because Erply's
  inventory is genuinely empty right now (see above).
- **Deactivate 146 products** currently active in Supabase but absent from
  Erply's active feed (3 of those are just SKU-casing mismatches — see
  below — the other 143 are genuinely not in Erply at all).

**Before ever pointing the sync at real data:** exclude `image_url` and
`stock_qty` from the upsert payload in `lib/product-sync.ts` (or fix the
underlying Erply data first — get images enabled + real inventory entered),
and manually review the 146 deactivate candidates.

## Image backfill pipeline (built, not yet runnable)

Two scripts, meant to run locally (not in a sandbox — Erply's API domain
isn't network-allowlisted there):

- `scripts/download-erply-images.mjs` — once Erply enables image access,
  pulls images for the 1,842 SKUs currently missing `image_url`, downloads
  them locally. Never writes an Erply URL into Supabase (no hotlinking, per
  Erply's ToS).
- `scripts/upload-images-to-cloudinary.mjs` — extended this session with
  optional CLI args (`imagesDir mappingCsv [logCsv]`) so it can push this
  batch to Cloudinary without duplicating the existing godaddy-backfill
  upload/DB-update logic.

Full detail: [`project-erply-image-backfill`](memory/project-erply-image-backfill.md).

## Data quality findings (from cross-checking Supabase against live Erply)

- **146 active Supabase products aren't in Erply's active feed** (at time of
  writing 2026-07-30 morning; re-checked same day evening via
  `scripts/check-erply-woo-health.mjs` after the F286606 duplicate-row fix
  below landed — count moved to **143**, expected since those 3 rows
  (`-Wt`/`-Pk`/`-BLK`) were deactivated and no longer count. Re-run the health
  script rather than trusting either number if picking this up later). 3 are
  SKU-casing mismatches only (`F286606-Wt`→Erply's real `F286606-WT`,
  `F286606-Pk`→`F286606-PK`, `F286606-BLK`→Erply's real `F286606-Blk` —
  note the casing that "wins" isn't consistent per color, checked each
  individually). The other **143 are genuinely missing from Erply** —
  exported with name/price to a CSV during the session (not committed to the
  repo, was a one-off chat deliverable — regenerate via the same query in
  `scripts/preview-erply-sync.mjs` if needed, or ask for it again). 116 of
  the 143 were auto-matched to an Erply product group by keyword; 27 need
  manual categorization. **Open question before creating any of them via
  `saveProduct`:** many are color/style variants of codes Erply already
  carries (e.g. `F286557-RD/-BU/-CL/-PK`) — same pattern as the separate
  Erply→WooCommerce integration's still-open "172 unmapped Woo products"
  question. Decide whether these should be flat new Erply products or
  matrix variations of an existing parent before importing.

- **Duplicate/wrong barcodes.** 106 barcode values are shared by more than
  one SKU (252 rows). Most (~62) are legitimate — one UPC covering a whole
  color family, not a bug. One family, `F286606` (3 colors), was a **real
  duplicate-listing bug** — 8 live rows for 4 colors — fixed 2026-07-30 (see
  [`project-duplicate-barcode-families`](memory/project-duplicate-barcode-families.md),
  logged in `audit_log`). One more likely duplicate,
  `F286573-LPK`/`F286573-PK` (both "Artificial Pink Rose", same barcode), was
  flagged but **not yet fixed** — was waiting on confirmation before
  deactivating either row. **41 groups are cross-family collisions** — two
  unrelated products sharing a barcode by data-entry error, not fixable from
  the database, needs a physical/supplier-invoice check. Three of those are
  systematic (not random): all 6 "DIY Pearl Beads" SKUs collide 1:1 with all
  6 "Pull Flower Ribbon" SKUs; 6 "Rectangular Compact Mirror" SKUs collide
  with unrelated ribbon/decor-clip SKUs; and 6 pairs of genuinely-different
  floral paper designs share barcodes. Full list:
  [`docs/BARCODE-CROSS-FAMILY-COLLISIONS.md`](BARCODE-CROSS-FAMILY-COLLISIONS.md).

## Open TODOs, roughly in priority order

1. ~~Decide on `F286573-LPK` vs `F286573-PK` and fix if confirmed.~~ Checked
   2026-07-30: `-LPK` is Erply's real code, `-PK` doesn't exist in Erply —
   but the two rows have different prices ($6.00 vs $8.00), so it's not a
   clean duplicate like F286606. **Held off** deactivating `-PK` pending a
   supplier-invoice/QuickBooks price check. See
   [`project-duplicate-barcode-families`](memory/project-duplicate-barcode-families.md).
2. Get Erply to confirm image API access is enabled; then run the image
   backfill pipeline above.
3. Get real inventory entered into Erply (or decide to keep managing stock
   outside Erply, e.g. the existing paper-count process — see
   `scripts/update-stock-from-paper-count.mjs`).
4. ~~Exclude `image_url`/`stock_qty` from the sync upsert in
   `lib/product-sync.ts` before ever enabling `app/api/sync/route.ts` for
   real, regardless of #2/#3's status.~~ Done 2026-07-30: `syncToSupabase`
   takes a new `options.skipFields` param; both Erply call sites
   (`app/api/sync/route.ts` cron and `app/admin/api/sync/route.ts` manual
   "Sync Now") now pass `skipFields: ['image_url', 'stock_qty']`, so a real
   sync leaves existing Cloudinary images and stock counts untouched. Excel
   import (`app/api/import/route.ts`) is unaffected — it still writes both
   fields from spreadsheet columns as before. This removes two of the four
   real-sync dangers found in "Do not sync yet" above; the 146-deactivate
   risk (item 6) is still unresolved, so `app/api/sync/route.ts` must stay
   pointed at stub/no credentials in Vercel prod until that's reviewed.
5. Resolve the 143-missing-from-Erply question (flat products vs. matrix
   variants), then build/run the `saveProduct` import if going the
   flat-product route. `scripts/match-deactivate-candidates.mjs` (added
   2026-07-30) auto-splits the 143 into 104 "same-family" (Erply carries a
   sibling code — this is exactly the matrix-variant case) vs. 39 "no-match"
   (genuinely absent) — see `data/erply-review/deactivate-candidates-matched.csv`.
   Still needs a decision on the 104, then handling the 39.
6. Review the 146 (now 143, see [[project-erply-woo-proactivity-setup]])
   deactivate candidates manually. **Partially done 2026-07-30**: 7
   same-barcode/inconsistent-category groups within the 143 were reviewed
   and confirmed as legitimate variations, not duplicate-listing bugs — see
   [[project-duplicate-barcode-families]] for the list and reasoning. The
   remaining ~136 (143 minus those 7 groups' member rows) are still
   unreviewed.
7. Physically verify the 41 cross-family barcode collisions
   (`docs/BARCODE-CROSS-FAMILY-COLLISIONS.md`), prioritizing the 3
   systematic patterns.

## Advisory (unrelated, surfaced in passing, still open)

`public.products_manually_hidden_backup_20260713` has Row Level Security
disabled — fully exposed to the anon/authenticated Supabase keys. Not fixed
(remediation SQL needs a decision on policies, not just flipping RLS on).
