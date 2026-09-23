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
