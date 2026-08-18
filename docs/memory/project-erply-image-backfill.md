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

**2026-08-17: remaining Cloudinary-only gap (168 SKUs) backfilled into
Erply's CDN via a new `scripts/backfill-cloudinary-images-to-erply.mjs`.**
The original 2026-08-03 Woo->Erply backfill above only covered SKUs that
already had a Woo image to pull from; `scripts/find-truly-missing-images.mjs`
found 168 SKUs where Supabase/Cloudinary has a real picture but WooCommerce
has none at all (list was in `data/images/image-source-matrix.csv`,
`cloudinaryHasImage=1 AND wooHasImage=0`). New script mirrors
`backfill-woo-images-to-erply.mjs` exactly (same CDN `/images/urls` endpoint,
context `erply-product`, adaptive chunk-split-on-504) but sources the URL
from Supabase's `image_url` instead of Woo's. All 168/168 uploaded
successfully, independently confirmed via a direct `GET
cdn.erply.com/images?productId=` read (not just trusting the upload script's
own success count) -- e.g. B325027 (productID 149) now has 1 CDN image,
F286376/T641585 had 1 pre-existing + gained a 2nd.

**Caught and fixed a real bug in the new script before the full run:** its
first Supabase query for `image_url` had no `.range()` pagination, silently
capping at Supabase's default ~1000-row limit -- on the >1000-row `products`
table this caused 87 of the first 168 candidate SKUs to look like they had
no `image_url` at all (`"No Supabase image_url (unexpected): 87"` on the
buggy run). Fixed by paginating the same way every other script in this repo
already does (`export-products-with-images-and-inventory.mjs`,
`find-truly-missing-images.mjs`, etc.) -- if a future one-off script queries
Supabase without an explicit `.range()` loop and the table might exceed
~1000 rows, expect the same silent truncation.

**Open finding, not yet resolved: image sync to WooCommerce is NOT
near-instant, unlike stock (see the +1000 stock test in
[[project-erply-pagination-fix]], which reflected in Woo within minutes).**
Checked live minutes after the image upload: 0/166 of the 168 backfilled
SKUs showed an image in WooCommerce yet, even though all 168 are confirmed
present on Erply's own CDN. Two live options, neither confirmed: (a) Erply's
WooCommerce Integration app syncs images on a slower/separate schedule than
stock/price (plausible -- matches [[project-woo-price-integration-markup-bug]]'s
finding that this integration is a fairly opaque Erply-side SaaS app with no
read/write API access to its own settings), or (b) it needs some kind of
manual trigger/republish on the Erply or WooCommerce side that hasn't been
identified. **Next session: re-check `data/images/cloudinary-erply-backfill-results.csv`'s
168 SKUs against Woo after more time has passed before assuming this is
broken** -- don't re-run the backfill script again on these SKUs (they're
already confirmed on Erply's CDN, re-uploading is redundant, not a fix).

**2026-08-17, later same day -- found and used the manual sync trigger, still
0/168 in Woo afterward.** Erply back office -> Apps -> My apps ->
Woocommerce Integration -> "View Existing Configurations" shows separate
last-run timestamps per sync type for the `ly-usa.com` integration: Products
sync, Prices sync, Inventory_sync. **Found the real cause of the lag:**
Products sync (which carries images) was stuck at **11.08.2026** (6 days
stale) while Prices/Inventory sync both ran same-day -- inventory even
self-triggered automatically and picked up all 2,074 IDs from the stock-1000
test on its own (confirmed via the "Succeeded stock cronjob sync" log entry),
but Products sync apparently does NOT run on a frequent automatic
schedule. The leftmost icon in each integration row's Actions column is a
manual **"Start sync"** button (confirmed via hover tooltip) -- clicked it
(Dragon's go-ahead) and got "Sync started successfully"; Products sync's
timestamp updated to 17.08.2026 14:46:18 and Sync status read "Done" within
~5 min.

**But Woo still showed 0/168 images even after Erply's own sync reported
Done.** Cross-checked Erply's separate "Image Storage App" (Apps -> My apps
-> Image Storage App -> Erply CDN tab) -- confirms all 168 backfilled images
are genuinely stored there with `context: erply-product`, timestamped from
the original backfill (14:25). So: Erply's own product+image data
confirmed correct and confirmed sent (sync status Done) -- the remaining gap
is most likely on WordPress's own side (e.g. WP-Cron / Action Scheduler
processing the incoming payload/media-import asynchronously), which isn't
something visible or actionable from the Erply side. This is squarely the
other team's territory now (same handoff boundary as
[[project-woo-price-integration-markup-bug]]) -- next step if this is still
unsynced later is to ask them to check WP-Cron/Action Scheduler health or
watch WooCommerce's own import/webhook logs, not to keep re-triggering
Erply's sync (already confirmed to have run and completed).

**Final status this session: polled every 5 min for ~50 min (10 checks)
after the manual "Start sync" completed -- stayed at 0/168 the entire
window, no movement at all.** This is no longer "just slow" -- ~50 min with
zero progress after Erply's own sync confirmed Done is long enough to treat
this as a real stuck/broken hop on the WordPress side, not normal lag.
**Don't re-trigger Erply's Products sync again for this** -- it already ran
and completed correctly (data confirmed on Erply's CDN, sync status Done).
The next productive step is on the other team: check WP-Cron/Action
Scheduler health on ly-usa.com, or WooCommerce's own webhook/import logs,
for whatever is supposed to consume Erply's Products sync payload and pull
the images in.

**ROOT CAUSE FOUND, 2026-08-17, later same day -- image sync was simply
switched off in the integration's own config the whole time, not broken.**
Erply back office -> Apps -> Woocommerce Integration -> "View Existing
Configurations" -> pencil/Edit icon -> **Field mapping (step 5) -> "Sync
Erply fields" tab** has a per-field toggle list controlling what the
Products sync includes: Product name, Quantity, **Product image**, Price
lists, Product code, Short description, Product dimensions, Brand, Product
price, Long description, Product groups, Country of origin. **"Product
image" is toggled OFF** (along with Short description and Long
description, which is separate/unrelated to this investigation). Every
other important field is ON. This fully explains every earlier finding in
this file: why Products sync completing ("Done") never produces an image
in Woo regardless of source (Erply CDN vs pre-existing) or age (today's
168-SKU push vs the 2-week-old IC44200 test) -- the sync was never
attempting to touch images at all, account-wide, this whole time. Not a
WP-Cron issue, not an Action Scheduler issue, not a webhook issue (all
already ruled out) -- just this one toggle.

**Not yet flipped on -- not done without Dragon's explicit go-ahead**,
since there's no visible per-product/scoped-test control on this screen; it
reads as an all-or-nothing account-level setting for the whole ly-usa.com
integration, and flipping it would presumably affect the entire catalog on
the next Products sync, not just the 168/171 SKUs this session has been
working with. **How to apply next session:** if Dragon wants images
flowing again, this toggle is the fix -- turn "Product image" on at
Field mapping -> Sync Erply fields, Save, then either wait for the next
scheduled Products sync or use the "Start sync" button on the main
configurations page (confirmed working, see the manual-trigger note
above) to force it immediately. Worth a heads-up to the other team first
given the account-wide scope, same as every other live write this
session.

**DECLINED, 2026-08-18 -- Dragon does not want to flip this toggle.** A past
attempt at image sync (unspecified which one, possibly predating this file)
caused issues Dragon isn't willing to repeat. **Do not propose flipping
"Product image" sync back on as a next step or top recommendation in future
sessions** -- treat the image-sync gap as accepted/parked, not a pending
task, unless Dragon explicitly reopens it himself.
