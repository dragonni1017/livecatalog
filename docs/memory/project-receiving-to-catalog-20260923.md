---
name: project-receiving-to-catalog-20260923
description: 2026-09-23 - five containers received (75 new Erply SKUs, stock verified landed); the sync could not insert them because products_id_seq collides with hand-assigned ids (migration 0052, NOT YET APPLIED); all 75 are in the catalog hidden at $0 awaiting manual Erply pricing
type: project
---

Five containers were applied through `/admin/receiving` on 2026-09-23
(TIIU5073956, TXGU6094406, EMCU0137238, EMCU8323054, EGSU8096690), creating
**75 new SKUs in Erply**. Stock landed: every one of the 75 reads back from
Erply at exactly its `qty_received`, checked per SKU.

Four things worth keeping:

1. **`products_id_seq` collides with hand-assigned ids, and it fails an
   entire chunk at a time.** Migration 0020 gave `products.id` a default of
   `'prod-' || lpad(nextval('products_id_seq'), 5, '0')`. That default is
   evaluated for every candidate row of an upsert, not just inserts, so a
   full sync burns ~3,200 values per run, while scripts that insert
   products directly assign `max+1` without touching the sequence. The
   sequence has now climbed into the block of ids hand-assigned on
   2026-09-01 (`prod-40493` .. `prod-40686`). The 16:48 sync inserted **0**
   of the 74 new SKUs and lost 652 rows' worth of updates with them:
   supabase-js upserts in chunks of 500 and one duplicate id fails the
   whole chunk. It is loud in the response's `errors[]` and invisible
   everywhere else -- it just looks like the products never arrived.
   `supabase/migrations/0052_products_id_seq_reseed.sql` reseeds it and is
   **not yet applied** (manual, Supabase SQL editor). Re-run it after any
   script that hand-assigns a block of ids.

2. **A received product is a $0.00 product, and $0.00 is orderable.**
   Erply cannot accept a price over the API on this account (proven
   2026-09-16), so everything receiving creates sits at price 0 until
   someone prices it in Erply by hand. `app/(catalog)` shows any row with
   `is_active && !manually_hidden`, and `lib/order-submission.ts` re-checks
   only those same two flags -- so a synced-in $0 product is a free product
   a customer can put on a real order. Eight had been live that way
   (F287699 since 08-19, five K2295xx + F288020 since 09-01, K229581 from
   today); they are hidden now. `lib/product-sync.ts` now hides any product
   it INSERTS at price <= 0, insert-only so it can never fight a deliberate
   visibility choice on an existing row.

3. **The admin "Sync Now" button was not the same sync as the cron.**
   `app/admin/api/sync/route.ts` mapped `p.categoryName` raw and passed
   `skipFields: ['image_url', 'stock_qty']` -- no alias map, no `'category'`
   skip -- so pressing it would have done exactly what
   [[project-erply-sync-category-safety]] stopped the cron from doing:
   ~26 flat Erply categories created, ~2,879 products reassigned off this
   catalog's consolidated ones. Fixed to match `/api/sync`. Worth checking
   any *second* caller of a shared library function that a safety fix was
   applied to; the fix was in the caller, not in `syncToSupabase`.

4. **Per-line apply confirmation never wrote, on all five shipments.**
   Every shipment row is `status='applied'` with `applied_at`/`applied_by`
   set, but no line has `applied_at`, `erply_stock_before` or
   `erply_stock_after`. That is the documented crash shape in
   `app/admin/api/shipments/apply/route.ts`: the shipment is flipped
   *before* the Erply call and the per-line write-back happens after a full
   `getErplyStockIndex` re-read. The registration itself succeeded (see
   above), so this is an audit gap, not lost stock, and re-applying is
   still blocked at the shipment level (409).

**How to apply:** the way in for a received container is
`node scripts/push-receiving-products-to-supabase.ts --apply` -- it reads the
SKUs receiving created, pulls name/group/barcode/price/stock from Erply,
assigns `prod-NNNNN` ids explicitly (so it does not depend on 0052), and
inserts them hidden at price 0 with real stock. It refuses any SKU Erply
already prices, because the sync owns the pricing formula. Then
`node scripts/upload-container-photos.mjs --apply` for the
`Downloads/<CONTAINER>Photos/` folders, and
`node scripts/zero-price-visibility.mjs --unhide --apply` once prices exist
in Erply and a sync has carried them across.

Photo folders are SKU-named with Chrome `" (2)"` re-download markers and
`-1`/`-2` extra views; an exact SKU match must be tried before treating a
trailing `-N` as a view, because real SKUs end in digits and hyphens
(`P273814-45cm` is a product, `B325123-1` is a second angle of `B325123`).
Of 305 files across 11 folders, 145 matched a product and 136 matched
nothing -- mostly SKUs from the three containers still staged from 09-18
(G3332xx, the F288023/F288024 colourways), because photos arrive before the
arrival list is staged.

Still open: 23 of the 75 have no photo (all the `FD…-25YARD` ribbons plus
CM35282, T642288, F288106), D701141 came through Erply group
"Uncategorized" and has `category_id` null, and **nothing is priced** --
all 75 stay hidden until that manual Erply pass happens.

See [[project-receiving-phase-1]] for the receiving flow itself,
[[project-erply-sync-id-default-outage]] for the first half of the id-default
story, and [[project-fake-stock-1000-hold]] for why Erply stock is not
blindly trusted elsewhere.

---

## Later the same day: three traps found while checking the import

**1. Two files describe one container, and `file_hash` does not stop the
second.** The supplier sends both an "Original List" and an "Arrival List"
for the same container. EGSU8096690 and EMCU8323054 were received from the
Arrival List, then staged again from the Original List -- 40/40 and 37/37
rows identical on SKU and quantity. Applying either would have added 48,456
and 117,440 pieces on top of stock already in Erply. The `file_hash`
idempotency key cannot catch this: it dedupes an identical *file*, and these
are genuinely different files describing the same shipment. Both were set to
`abandoned` on 2026-09-23. **Before applying anything, check whether that
container already has an applied shipment under a different file name.**

**2. Erply's uniqueness check can be bypassed by a fast double-submit.**
F288132 existed twice -- productID 3123 and 3124, same `code`, same `code2`,
both `added` in the same second. This is the same constraint that produces
the 1012 errors, so it is enforced, just not against a concurrent create.
Only 1 such pair in 3,165 products. What made the cleanup non-obvious: the
**stock was on 3123 and the images were on 3124**. Stock cannot be moved
(Erply has no "set stock", only deltas, so moving it means a registration
plus a write-off and two ledger entries), images re-push in one command --
so keep whichever holds the stock. 3124 was deleted, the shipment line
repointed to 3123, and the image re-pushed.

Two things learned in that cleanup:
- **Deleting a product does not delete its CDN images.** The listing still
  returns the 3124 records, now orphaned against a product that is gone.
  Harmless, but it means the CDN listing is not a reliable product census.
- **`import-all-cloudinary-images-to-erply.mjs` resumes from
  `data/images/cloudinary-erply-full-import-results.csv`** and will skip any
  SKU logged there. After deleting a product that held the image, that row
  has to come out of the log or the re-push silently does nothing.

**3. A SKU-indexed Erply snapshot hides a duplicate.** The first pass at
verifying stock read "F288132 expected 1500, got 0" -- the empty twin had
overwritten the real one in a `Map` keyed by code. A per-SKU exact lookup
earlier the same day had reported it correct. If a stock check disagrees
with itself between runs, suspect a duplicate code before suspecting the
stock.

State at end of 2026-09-23: 6 shipments applied, 2 abandoned, 1 (EGSU1396926,
66,036 pcs) genuinely still to receive. 85 SKUs created, all 85 in the
catalog, all 85 hidden, all 85 verified against Erply stock, 60 with photos,
0 priced.

## A container can be stocked twice when a script got there first

**5,200 pieces were double-added on 2026-09-23 and written off the same
day.** Container EGSU9509206's August arrival list had already been stocked
on 2026-09-03 by `scripts/add-stock-from-arrival-lists.mjs` (Erply
registration docs 44+45), and was then received again through
`/admin/receiving` (doc 51).

**Why nothing caught it:** the `file_hash` guard only knows about shipments
staged through the app. A script leaves no `shipments` row, so from the
receiving screen that container had never been received. This is a wider
hole than the Original/Arrival duplicate above — there is no app-side record
to compare against at all. **Before applying any container whose ETA is in
the past, check whether a script already stocked it.** The 09-03 run covered
seven August containers.

**Only 4 of doc 51's 14 rows were duplicates.** The other 10 (20,373 pieces)
were SKUs that did not exist in Erply on 09-03, so the script could not have
stocked them — they are legitimate first-time additions. Reversing the whole
document would have destroyed real inventory. `scripts/writeoff-double-added-stock.mjs`
derives the overlap from Erply's own registration documents and writes off
only where the same product appears in both with the **same amount** — equal
amounts mean one shipment counted twice, different amounts mean the SKU
genuinely arrived on two containers (`P273810-60cm`: 1,056 then 372, left
alone).

Verified three ways before writing: all 25 arrival lists on disk contain
these 4 SKUs on exactly one container; receiving staged `shipped == received`;
and Erply's full movement ledger reconciled to the piece for each one. That
last check also proved none had sold — stock equalled the sum of all
documented movements, and a sale would have made it lower.

**`saveInventoryWriteOff` requires a `reasonID`; `saveInventoryRegistration`
does not.** Without one it fails `Erply error 1010: reasonID` and writes
nothing. The account's four original codes (samples, depreciation, broken
items, warehouse leftovers) all misdescribe a bookkeeping correction, so
**reason id 5 "Data correction - duplicate entry" (code DATACORR, purpose
WRITEOFF) was created in the Erply back office** for this and future
corrections — reason codes cannot be created over the API, only read with
`getReasonCodes`. Use id 5 for any future correction of this kind.

Final state of the four: D701027 2,160 · F287862 1,720 · F287866 1,720 ·
F288017 1,600 — Erply, the catalog and the movement ledger all agree. Note
F287862/F287866 keep the fake 1,000 from 2026-08-17 (see
[[project-fake-stock-1000-hold]]); that is the standing decision, not an
error.
