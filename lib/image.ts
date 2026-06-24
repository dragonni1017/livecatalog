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
