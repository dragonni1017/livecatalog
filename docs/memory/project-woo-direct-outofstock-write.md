---
name: project-woo-direct-outofstock-write
description: 2026-08-17 -- direct WooCommerce writes to stock_status are silently reverted by WooCommerce itself when manage_stock=true and stock_quantity>0; only the 66 unmanaged-stock drafts actually flipped, 75 live/published products left instock by decision
type: project
---

Dragon asked to flip every Woo product that is `stock_status=instock`, has no
image, and doesn't read `stock_quantity=1000` (i.e. wasn't part of the
deliberate connectivity-test stock write, see
[[project-erply-pagination-fix]]) to `outofstock`. Built
`scripts/set-woo-outofstock-no-image-not-1000.mjs` -- the first script in
this repo that writes directly to WooCommerce's own product data rather than
through Erply. Dragon flagged this to the team that now owns the live
WooCommerce site before approving the run (same handoff pattern as
[[project-woo-price-integration-markup-bug]]).

**141 candidates found: 66 drafts (manage_stock=false, not customer-facing
at all) + 75 live/published products (manage_stock=true, mostly reading
`stock_quantity=2000` -- the still-unexplained doubling from the Erply
stock-1000 connectivity test, overlapping heavily with the SKUs still
mid-flight in the Cloudinary->Erply image backfill,
[[project-erply-image-backfill]]).**

**Found live: WooCommerce's own batch API reported 141/141 updated, 0
failed -- but that response is NOT trustworthy for `manage_stock=true`
products.** Independent re-fetch immediately after showed only 66/141
actually landed (exactly the drafts). All 75 `manage_stock=true` products
silently reverted to `instock` -- WooCommerce recomputes `stock_status` from
`stock_quantity` on save when stock is managed, so a direct `stock_status`
write is overridden back to whatever the quantity implies (2000 > 0 ->
instock) unless `stock_quantity` is also changed. This is core WooCommerce
behavior, not a bug in the write script.

**How to apply:** don't trust a WooCommerce product-update API response
(batch or single) as proof a `stock_status` write stuck for a
`manage_stock=true` product -- always re-fetch and check independently, same
discipline as every Erply bulk-write script in this repo already follows.
To actually force `outofstock` on a managed-stock product, either also zero
`stock_quantity` (a real inventory-data change, not just a status flag) or
flip `manage_stock` to false first (changes how WooCommerce tracks that
product going forward). **Dragon's decision 2026-08-17: don't do either yet
for these 75** -- left `instock`/`qty=2000` alone, revisit once the image
backfill finishes syncing (several of the 75 are the exact SKUs waiting on
that). Backup of the full 141-row plan (with old/new status, manage_stock,
quantity) is in `data/woo-outofstock-no-image/planned-changes.csv`.

**2026-08-17, later same day -- superseded.** Confirmed separately
([[project-erply-image-backfill]]'s final finding) that Erply's Products
sync never pushes images to Woo at all, regardless of source or age -- so
"revisit once the image backfill finishes syncing" was never going to
happen. Dragon instead asked to revert the whole stock-1000 connectivity
test for any SKU still showing no working image, in both Erply and
WooCommerce. Scoped live: of the 2,074 stock-1000-test SKUs, 171 had no
working image in Woo (this specific 75-live-product set was a subset of
those 171). Built `scripts/revert-stock-1000-no-image.mjs`, ran it, **all
171 reverted successfully in both systems, independently verified** --
Erply stock=0 (`saveInventoryWriteOff`, warehouse 1, reasonID 4 "warehouse
leftovers"), Woo `stock_status=outofstock` AND `stock_quantity=0` together
(zeroing quantity alongside status is what made it stick this time, per the
finding above). See [[project-erply-pagination-fix]] for the full
stock-1000-test lifecycle. No further action pending on the 75/141 threads
from this node -- both are now resolved via the revert.
