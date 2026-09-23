---
name: project-image-sizing-contract
description: 2026-09-23 - stored image URLs are always RAW originals and every width is applied at render time by lib/image.ts; do not pre-compress before Cloudinary and do not bake a transform into the stored URL
type: project
---

**The contract: `products.image_url` / `image_urls` store the raw Cloudinary
original, and every width is applied at render time** by `resolveCdnImage()`
in `lib/image.ts` (`f_auto,q_auto,w_<n>,c_limit` for Cloudinary,
`?width=&format=webp` for `cdn.erply.com`). Verified 2026-09-23: 0 of 3,300
rows have a transform baked into the stored URL.

**So local photos do NOT need compressing before upload.** Measured on a
real product (K229582, uploaded straight from a 1.95 MB phone JPEG):

| URL | delivered |
|---|---|
| raw original | 1,995,368 B jpeg |
| `f_auto,q_auto,w_800,c_limit` | 50,786 B webp |
| `f_auto,q_auto,w_150,c_limit` | 4,614 B webp |

Keeping the original also matters because ~8 scripts push `image_url`
verbatim to Erply and WooCommerce, and because a baked-in transform would
trip `cdnImage`'s "already has a transform" guard and permanently lock that
SKU to one width.

**Two things that broke the contract, both fixed 2026-09-23:**

- `ImageGallery` was handed `additionalUrls={product.image_urls}` raw, so
  every product detail page downloaded a full-size original to fill a 56px
  thumbnail -- and Next emitted `<link rel="preload" as="image">` for it, so
  it was fetched eagerly at high priority. The component now takes RAW urls
  on both props and sizes them itself (`MAIN_WIDTH` 800, `THUMB_WIDTH` 150),
  because the two slots want very different widths and a pre-transformed
  prop can only carry one.
- `SearchInput` passed the raw URL to `next/image`. The browser result was
  always tiny, but Vercel's optimizer was pulling the multi-MB original from
  origin and burning a transformation per suggestion row.

Also fixed in passing: `image_urls[0]` repeats `image_url` on 991 of the
1,184 visible products with an image, which rendered the same photo as the
first two thumbnails. The gallery de-dupes now.

**How to apply:** when adding any new image render site, call
`resolveCdnImage(url, <the width that slot actually displays>)`. A URL that
is neither Cloudinary nor `cdn.erply.com` is returned untouched -- one
product (`prod-00002`) has a Supabase Storage `image_url` and therefore gets
no optimization at all, so a non-CDN URL silently bypasses this whole
mechanism.

See [[project-erply-image-backfill]] for how images get into Cloudinary in
the first place, and [[project-receiving-to-catalog-20260923]] for
`scripts/upload-container-photos.mjs`, which uploads originals on purpose.
