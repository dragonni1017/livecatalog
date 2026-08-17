/**
 * Cloudinary on-the-fly image optimization.
 *
 * Product images are stored as full-resolution PNGs (often 2–7 MB each). Serving
 * them raw means a catalog page of 48 cards downloads ~140 MB. Cloudinary can
 * resize + re-encode on delivery via URL params, so we inject a transformation
 * into the delivery URL at render time:
 *
 *   .../image/upload/v123/foo.png
 *   .../image/upload/f_auto,q_auto,w_400,c_limit/v123/foo.png
 *
 *   f_auto  → best format the browser supports (WebP/AVIF)
 *   q_auto  → automatic quality compression
 *   w_<n>   → resize to the display width
 *   c_limit → never upscale beyond the original
 *
 * Non-Cloudinary URLs (or ones that already carry a transform) are returned
 * untouched.
 */
export function cdnImage(url: string | null | undefined, width: number): string | null {
  if (!url) return url ?? null

  const marker = '/image/upload/'
  const idx = url.indexOf(marker)
  if (idx === -1) return url // not a Cloudinary delivery URL — leave as-is

  const after = url.slice(idx + marker.length)
  const firstSegment = after.split('/')[0]

  // If the first segment already looks like a Cloudinary transformation
  // (tokens like w_, f_, q_, c_, e_, g_ …), don't add another one.
  if (/(^|,)(f|q|w|h|c|e|g|b|o|dpr|ar|r)_/.test(firstSegment)) return url

  const transform = `f_auto,q_auto,w_${width},c_limit/`
  return url.slice(0, idx + marker.length) + transform + after
}

/**
 * Erply CDN on-the-fly image resize -- an alternative to cdnImage() above,
 * for image_url values that point at cdn.erply.com instead of Cloudinary
 * (see docs/memory/project-erply-image-backfill.md: the CDN API, unlike
 * Erply's legacy getProducts.images field, has no documented hotlinking
 * restriction and is explicitly cache-optimized for direct serving).
 *
 * Deliberately NOT merged into cdnImage() -- kept as a separate function so
 * the Cloudinary path above stays untouched and this can be pulled back out
 * cleanly if the Erply CDN direction doesn't work out.
 *
 * cdn.erply.com's GET /assets/{tenant}/image/{hash} supports `width`,
 * `height`, and `format` (webp only) query params -- confirmed against the
 * CDN's own swagger doc (cdn.erply.com/documentation/swagger/doc.json).
 * There's no q_auto/c_limit equivalent: no quality param, and per the docs
 * "Use width and height parameters to resize image size" with no stated
 * upscale-limiting behavior, so this only ever sets width (not height, to
 * preserve aspect ratio) and requests webp.
 *
 * Non-Erply-CDN URLs (or malformed ones) are returned untouched.
 */
export function erplyCdnImage(url: string | null | undefined, width: number): string | null {
  if (!url) return url ?? null

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  if (parsed.hostname !== 'cdn.erply.com') return url

  parsed.searchParams.set('width', String(width))
  parsed.searchParams.set('format', 'webp')
  return parsed.toString()
}

/**
 * Dispatches to cdnImage() or erplyCdnImage() based on which CDN a given
 * image_url actually points at. Call sites that just want "the right
 * transform for whatever this product's image_url happens to be" (rather
 * than assuming Cloudinary) should use this instead of calling cdnImage()
 * directly -- it's what makes the two functions above a drop-in mix rather
 * than requiring every image_url in the DB to be on one CDN.
 */
export function resolveCdnImage(url: string | null | undefined, width: number): string | null {
  if (!url) return url ?? null
  if (url.includes('cdn.erply.com')) return erplyCdnImage(url, width)
  return cdnImage(url, width)
}
