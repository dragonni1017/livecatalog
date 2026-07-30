---
name: project-erply-image-backfill
description: Erply image API access being requested; download+upload scripts scaffolded to backfill the 1,842 SKUs with no image_url
type: project
---

Erply's product image URLs (`getProducts`/`getProductPictures`, field `images`)
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

**How to apply:** once Erply confirms image API access is on and
`ERPLY_CLIENT_CODE`/`ERPLY_USERNAME`/`ERPLY_PASSWORD` are set in
`.env.local`, run `download-erply-images.mjs` then
`upload-images-to-cloudinary.mjs data/images/erply-images
data/images/erply-image-mapping.csv` locally (not in a sandbox — Erply's API
domain isn't reachable from there, same as the existing godaddy backfill
scripts). Fix the `ErplyProduct.images` type / `normalizeProduct` primary-image
logic in `lib/erply.ts` before that, ideally in the same session as turning on
real credentials.
