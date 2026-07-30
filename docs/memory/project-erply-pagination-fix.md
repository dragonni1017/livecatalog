---
name: project-erply-pagination-fix
description: getErplyProducts() had three live-data bugs (pagination truncation, wrong stock field name, nonexistent isPrimary flag) found and fixed 2026-07-30 by testing against the real Erply account
type: project
---

`lib/erply.ts`'s `getErplyProducts()` computed `totalPages = Math.ceil(total /
PAGE_SIZE)` with `PAGE_SIZE = 300` hardcoded, then looped `page <= totalPages`.
Confirmed live against the real Erply account (2,870 active products) that
Erply silently caps `recordsOnPage` at 200 whenever `getStockInfo=1` is
passed, regardless of what's requested — `fetchProductPage` requests
`getImages=1, getStockInfo=1` together, so it always hit this cap. With
`total=2870` and the assumed `PAGE_SIZE=300`, `totalPages` came out to 10,
but each page only actually returned 200 records — so the loop stopped after
collecting ~2,000 of 2,870 products (~30% silently missing), with no error
surfaced anywhere.

Verified via live pagination test that Erply's `pageNo` offset tracks the
*actual* records returned per page, not the requested `recordsOnPage` — so
continuing to request `recordsOnPage=300` while just looping until
`accumulated >= total` (instead of precomputing page count) is correct and
gap-free. Fixed in both `lib/erply.ts` (`getErplyProducts`) and
`scripts/download-erply-images.mjs` (`getAllErplyProducts` — not currently
affected since it omits `getStockInfo`, but had the same fragile pattern).

Two more bugs found the same way (live data, never exercised before since the
integration only ever ran in stub mode):

1. `ErplyProduct.images[].isPrimary` doesn't exist in Erply's response (real
   fields: `pictureID, name, thumbURL, smallURL, largeURL, fullURL, external,
   hostingProvider, hash, tenant`). `normalizeProduct` used to `.find(isPrimary
   === 1)`, which would just always fall through to `.images?.[0]` anyway —
   fixed to take `images[0]` directly, no functional change, just removes a
   reference to a field that was never real.
2. `ErplyProduct.amountInStock` / `reservedAmount` don't exist either — real
   shape is `warehouses: Record<warehouseID, { totalInStock, reserved, ... }>`.
   The old code's `stockQty: p.amountInStock ?? 0` would have written **0
   stock for every single product on the first real sync**, silently
   overwriting whatever `stock_qty` values already existed (full-row upsert
   in `product-sync.ts`). Fixed to sum `totalInStock` across all warehouses.
   Confirmed live: this account has warehouse 1 "L&Y USA" and warehouse 2
   "Store LA" — and both currently read 0 for every product sampled (670 of
   2,870, spread across different pages, not just one contiguous block). This
   is the same symptom as the separate Erply→WooCommerce integration's
   "entire catalog out of stock" problem, but confirmed here to be real
   Erply-side inventory data (zero in every warehouse), not a warehouse-ID
   misconfiguration in one particular integration.

**Why:** this repo's Erply integration has been running in stub mode since
inception (see `isConfigured()` / `ERPLY_CLIENT_CODE`), so this pagination
path had literally never executed against real data before — it was only
caught by testing live once [[project-erply-image-backfill]] required real
credentials in `.env.local`.

**How to apply:** if any *other* Erply API call in this codebase gets added
later with `recordsOnPage` + a param that might trigger a per-request cap
(check `learn-api.erply.com` request docs for language like "at most you can
request N... or only M if X is set"), use the same accumulate-until-total
loop pattern rather than a precomputed page count. Don't assume
`recordsOnPage` requested equals `recordsOnPage` returned.

`scripts/preview-erply-sync.mjs` (added 2026-07-30) is a read-only dry run —
confirmed the pagination fix pulls all 2,870/2,870 products (previously would
have stopped at ~2,000). It also extends past what `previewSync()` in
`product-sync.ts` checks (insert/update/deactivate/categories only) to flag
what this investigation found is the real danger: a real sync today would
overwrite `image_url` to null on **1,028** products (every one that currently
has a working Cloudinary image) and `stock_qty` to 0 on **all 2,870**
products, because Erply's images access isn't enabled yet and its inventory
genuinely reads 0 everywhere. It also surfaced a new, previously-unknown
finding: **146 products currently active in Supabase aren't in Erply's active
feed at all** — a real sync would deactivate/hide them from the storefront.
**Do not point `app/api/sync/route.ts` at real credentials until `image_url`
and `stock_qty` are excluded from the upsert payload (or Erply's own data is
fixed first) and the 146 deactivate candidates have been reviewed.**
