---
name: project-admin-cleanup-queue
description: 2026-10-01 - /admin/cleanup built (photo/name/category/description queue); description made insert-only in the Erply sync; found supabase-js bulk-upsert NULLs absent keys on existing rows, which very likely nulled category_id on 666 products
type: project
---

`/admin/cleanup` is a "needs attention" queue over ACTIVE products: photo
(no image_url or needs_photo), name (any auditProductName issue), category
(no category_id AND no product_categories row), description (blank). First
live counts, 2026-10-01: photo 879, name 212, category 147, description 299.
Not yet exercised in a browser or against a real upload.

**Decisions (Dragon, final, 2026-10-01):**

- Photos go to Cloudinary and the catalog ONLY, never pushed to Erply/Woo.
  Browser uploads straight to Cloudinary with a per-public-id signature from
  `/admin/api/cleanup/photo-signature`. Bytes never pass through a Vercel
  function (4.5 MB body cap). Public ids follow receiving: `SKU`, `SKU-n`, no
  folder. `/admin/api/cleanup/photos` refuses any URL that isn't a raw
  original for that SKU on this cloud.
- Descriptions are catalog-owned. `'description'` is in skipFields in both
  sync routes and is insert-only, like category: a new product still gets
  Erply's text, an existing one is never overwritten. The Excel import
  (now `/admin/api/import`) is insert-only for both too, since #78.

**The gotcha (second time this mechanism has bitten):** supabase-js sends a
bulk upsert's `columns` as the UNION of every row's keys. A row missing a
listed key is sent NULL, and ON CONFLICT DO UPDATE writes that NULL over the
existing value. The first time was `manually_hidden` on 2026-09-24 (NOT NULL,
so it failed loudly). The quiet version: the old insert-only `category_id`
put the key on new rows only, so any 500-row chunk holding a new product
NULLed category_id on every existing product in it. On 2026-10-01, all 2,500
products with a category_id also had it in product_categories, and 666 more
had a join row but a NULL category_id. The admin PATCH can't produce that
state, so the old code very likely did. `syncToSupabase` now upserts new and
existing rows in separate batches (`tests/product-sync-skip.test.ts`).
**The 666 have NOT been repaired**: they still show in their category through
the join table, but anything reading only `products.category_id` misses them.
Repairing means a live write: set category_id from the join row, which is
ambiguous when a product has several.

**Name fixes** go through `lib/product-name-fix.ts`, shared with
`scripts/fix-product-names.ts`; the script's dry-run output was diffed
identical before and after the refactor. The route returns 503 where Erply
isn't configured (Vercel prod), so in practice this is local-only. It also
refuses any change that adds, removes or alters the pack spec, including the
unit. That is stricter than "prefill only from the suggestion": only 1 of the
212 flagged names has a mechanical suggestion, and most of the rest are
missing_pack_spec, which this screen therefore can't fix. Loosening it is a
one-line change in the route, but it is Dragon's call.
`auditProductName`'s suggestion drops a stated case unit (`cs.25pk` becomes
`cs.25`). `lib/cleanup.ts` withholds such suggestions; 0 live names hit this.

**How to apply:** before adding any insert-only or conditionally-present
column to a bulk upsert, keep rows with different key sets in different
upsert calls. See [[project-image-sizing-contract]] for the raw-URL rule and
[[project-local-photos-skus-not-in-erply]] for why the local photo folder
mostly won't match.
