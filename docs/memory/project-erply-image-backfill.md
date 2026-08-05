---
name: project-erply-image-backfill
description: DONE 2026-08-03 -- Woo-to-Erply image backfill complete (1,899/1,899, 100%) via CDN /images/urls; Erply image API confirmed live, no longer gated
type: project
---

**Backfill 100% complete, confirmed 2026-08-03 (run locally by Dragon):**
1,899/1,899 SKUs uploaded via `scripts/backfill-woo-images-to-erply.mjs`. An
initial run finished 1,894/1,899 with 8 transient client-side `fetch failed`
errors against `cdn.erply.com` (FD400032, L842063, F287528, F287842,
F286997, F286519, P257258, T640973 — all independently verified as
reachable, well-formed images, so a network blip not a real per-SKU issue);
a re-run of the same command picked up only those 8 via the resumable CSV
log and finished 8/8. Nothing left to do on this backfill.

**UPDATE 2026-08-03: image API access is confirmed ON, both directions.**
The "gated" status below was true as of 2026-07-30 but is now stale. Tested
live: `saveProductPicture` (upload, base64) succeeded on SKU IC44200
(productID 2847) -> `productPictureID: 1`, and an immediate `getProducts
code=IC44200 getImages=1` / `getProductPictures productID=2847` read-back
showed the real image, hosted on Erply's own CDN
(`https://cdn.erply.com/assets/552309/image/IC44200.jpg`, `hostingProvider:
"amazons3"`, `external: 1`). So: reading is unblocked, and uploading a real
file (not a URL/hotlink) works and gets served from Erply's own
infrastructure -- no ToS concern with this upload path specifically. Don't
trust "gated" as a reason to skip the image backfill without re-testing
first; this can apparently change without an explicit heads-up from Erply.

~~Original 2026-07-30 status, kept for history:~~ Erply's product image URLs
(`getProducts`/`getProductPictures`, field `images`)
are gated ("not accessible by default") and, once enabled, must not be
hotlinked — Erply's own docs require downloading the file and serving it from
infrastructure you control. Dragon has a support contact at Erply and is
requesting image API access be turned on for the account (as of 2026-07-30,
not yet confirmed enabled).

`scripts/download-erply-images.mjs` (added 2026-07-30) pulls images for every
SKU currently missing `image_url` in Supabase — cross-referenced against a
2026-07-28 Erply product export, 1,842 of 2,870 SKUs have none — and downloads
them locally. `scripts/upload-images-to-cloudinary.mjs` was extended with
optional CLI args (`imagesDir mappingCsv [logCsv]`) so it can push that batch
to Cloudinary and update `products.image_url` without duplicating the
upload/DB-update logic that already existed for the godaddy backfill.

Also: `lib/erply.ts`'s `ErplyProduct.images` type only declares `{ largeURL,
isPrimary }`, but Erply's documented response has no `isPrimary` field at all
(actual fields: `pictureID, name, thumbURL, smallURL, largeURL, fullURL,
external, hostingProvider, hash, tenant`). That type was written for stub mode
and never validated against real data — fix it (and the `.find(isPrimary)`
logic in `normalizeProduct`) before flipping on real Erply credentials, or
`app/api/sync/route.ts` will start hotlinking `largeURL` straight into
`image_url`, which both violates Erply's ToS and bypasses the Cloudinary
resize pipeline in `lib/image.ts` (`cdnImage()` only transforms
`res.cloudinary.com` URLs — anything else, including a raw Erply URL, is
served untouched, full resolution).

**Why:** the 172 unmapped Woo products / broken-image-on-Woo-sync issue from
the separate Erply→WooCommerce integration (not in this repo) surfaced that
Erply's product cards are sparse on images/descriptions catalog-wide — the
same gap shows up here independently, via direct SKU cross-reference against
livecatalog's own DB.

**New direction as of 2026-08-03: Woo -> Erply (opposite of the original
Erply -> Cloudinary/Supabase backfill this file was written for).**
[[project-erply-woo-compare-script]]'s field-diff found ~1,900 SKUs where
WooCommerce has an image but Erply doesn't (all self-hosted on
`ly-usa.com/wp-content/uploads/...`, not hotlinked from anywhere -- see that
node for detail).

**Which Erply write API actually reaches the WooCommerce integration --
resolved 2026-08-03, read this before using either API again.** Erply's own
WooCommerce FAQ (wiki.erply.com/fi/article/1265) warns that pictures added
under the legacy "Product pictures" module do NOT reach Woo through their
integration -- only pictures in the "Pictures" module ("Pictures in Erply
CDN") do. This raised a real concern that the classic `saveProductPicture`
call (tested on IC44200 earlier this session) might have landed in the wrong
place. Investigated by finding Erply's actual CDN API (`cdn.erply.com`,
swagger at `cdn.erply.com/documentation/swagger/doc.json`) and its
`POST /images/urls` endpoint, which the CDN API docs say requires
`context: "erply-product"` to count as a real product picture. Tested
`/images/urls` on the same product (IC44200, productID 2847) and then read
back `GET https://cdn.erply.com/images?productId=2847`: it returned **3**
images total -- one pre-existing (order 1, dated ~mid-June 2026, before this
session touched anything), the `saveProductPicture` upload from earlier
(order 2), and the new `/images/urls` upload (order 3) -- and all three
carry `"context": "erply-product"`. Since `saveProductPicture` demonstrably
writes into the same CDN table with the same context value the CDN docs
require, it's very likely fine too, not the wrong "Product pictures" legacy
module the FAQ warns about (that legacy module is probably something else
entirely, not exercised by either API used this session). Not 100%
conclusive without Dragon actually running a scoped Woo sync on IC44200 and
confirming the image shows/updates there -- recommended as the real proof
before trusting this fully.

**Backfill approach, updated to use `/images/urls` instead of
`saveProductPicture`:** no download/convert/base64 needed at all -- Erply's
CDN fetches the URL itself, and it accepted a raw `.webp` URL directly in
testing (so the earlier assumption that only JPEG/PNG works, from the
unrelated "Image Store App" FAQ, does not apply to this endpoint). Request
body: `{"requests": [{"context": "erply-product", "product_id": <erply
productID>, "sku": "<sku>", "url": "<woo image src>", "filename":
"<sku>.<ext>"}, ...]}` (array supports multiple products per call -- batch
size not documented, chunking conservatively). Auth: `verifyUser`'s response
has a `token` field (JWT, scoped with `CDN/manage-resources` permission) --
pass it as header `JWT` directly to `cdn.erply.com`, no separate CDN-session
exchange needed in practice (the documented `POST /session?jwt=...` step
appears to be for the older/deprecated `API_KEY` header flow).
See `scripts/backfill-woo-images-to-erply.mjs`.

**How to apply (original Erply -> Cloudinary direction, still relevant for
the ~39 no-match SKUs from [[project-erply-pagination-fix]] that have no Woo
image either):** once Erply confirms image API access is on and
`ERPLY_CLIENT_CODE`/`ERPLY_USERNAME`/`ERPLY_PASSWORD` are set in
`.env.local`, run `download-erply-images.mjs` then
`upload-images-to-cloudinary.mjs data/images/erply-images
data/images/erply-image-mapping.csv` locally (not in a sandbox — Erply's API
domain isn't reachable from there, same as the existing godaddy backfill
scripts). Fix the `ErplyProduct.images` type / `normalizeProduct` primary-image
logic in `lib/erply.ts` before that, ideally in the same session as turning on
real credentials.
