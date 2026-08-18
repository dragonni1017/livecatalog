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

**Reconfirmed 2026-08-17, still unfixed on Erply's side (before the test
below):** ran `scripts/export-products-with-images-and-inventory.mjs` live
(2,113 active Supabase products with a real image, 2,074 matched an active
Erply SKU) -- all 2,074 read exactly 0 stock, summed across both warehouses.
Not a placeholder/dummy value like 1000, genuinely zero everywhere, same as
the 2026-07-30 finding above. No change on Erply's end in the ~2.5 weeks
since.

**2026-08-17, later same day -- Dragon deliberately set warehouse 1 ("L&Y
USA") stock to 1000 for these same 2,074 SKUs as a live connectivity test**
(does Erply stock actually reach WooCommerce/WordPress?), via the new
`scripts/set-erply-stock-1000-test.mjs`. Not a real inventory count --
**live Erply stock for these 2,074 SKUs currently reads 1000 in warehouse 1
as fabricated test data, not their real 0.** Confirmed via independent
re-fetch after writing: all 2,074 numerically read 1000 (Erply returns
`totalInStock` as a numeric string like `"1000.000000"`, so compare with
`Number(...) === `, not `===`, or a real match will show as a false
mismatch). Warehouse 2 ("Store LA") and the 39 no-Erply-match SKUs were
untouched, still 0. Backup of exactly what changed (productID, sku, name,
oldStock=0, newStock=1000, delta=+1000) is in
`data/erply-stock-1000-test/planned-changes.csv` (gitignored, local only).
Dragon flagged this to the team now owning the live WooCommerce site before
running it, per [[project-woo-price-integration-markup-bug]]'s handoff
note.

**How to apply:** this is temporary test data sitting live in Erply/on the
storefront pipeline right now -- don't treat 1000 as real stock for these
SKUs in any future session, and don't re-run
`export-products-with-images-and-inventory.mjs` or similar and assume 0 is
still current without re-checking. **Revert path, not yet run:** Erply has
no "set absolute stock" call, only deltas -- reverting these 2,074 back to 0
needs `saveInventoryWriteOff` (removes stock) with a valid `reasonID`, which
requires a separate lookup (e.g. `getInventoryWriteOffReasons` or checking
Erply's back office) not done this session. `set-erply-stock-1000-test.mjs`
only implements the forward (registration) direction and will refuse to run
if it finds stock already above 1000 rather than guess a write-off.

**2026-08-17, later same day -- partial revert completed, scoped to the
no-image subset.** After confirming images never sync to Woo via Erply's
integration regardless of source/age (see
[[project-erply-image-backfill]]'s final finding), Dragon asked to revert
the test for any SKU still showing no working image in Woo, in both
systems. 171 of the 2,074 test SKUs qualified (the other 1,903 have a
working, usually pre-existing/Woo-native image and were deliberately left
at stock=1000). Built `scripts/revert-stock-1000-no-image.mjs` -- the
write-off script this node's "not yet run" note was waiting on, using
reasonID 4 ("warehouse leftovers", Dragon's pick from the account's only 4
configured reason codes). **All 171 reverted successfully, independently
verified in both systems** (Erply warehouse-1 stock=0; Woo
`stock_status=outofstock` + `stock_quantity=0` together -- see
[[project-woo-direct-outofstock-write]] for why both fields are required).
Backup: `data/revert-stock-1000-no-image/planned-changes.csv`.

**Current state of the stock-1000 test, for any future session:** 1,903
SKUs still intentionally read stock=1000 (real stock is actually 0, but
they display fine with a working image so left as-is); 171 SKUs are back to
their real pre-test state (0/outofstock, both systems). Don't assume either
number is "real" inventory without re-checking -- both are deliberately
diverged from Erply's true 0 for different reasons.
