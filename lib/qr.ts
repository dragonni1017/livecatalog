import QRCode from 'qrcode'

// QR codes as plain SVG path data, built on the server. Vector output prints
// sharp at any size, and rendering our own <path> (rather than the library's
// SVG string) avoids dangerouslySetInnerHTML.

export const SITE = 'https://lyusa.app' // same base as app/sitemap.ts and lib/product-jsonld.ts

export function productUrl(productId: string): string {
  return `${SITE}/product/${encodeURIComponent(productId)}`
}

/**
 * One "M x y h1 v1 h-1 z" square per dark module, in a size×size grid with no
 * quiet zone (the caller leaves white space around it). Error correction M
 * survives a bit of print smudge without making the code denser than needed.
 */
export function qrPath(text: string): { size: number; d: string } {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' })
  const { size, data } = qr.modules
  const parts: string[] = []
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (data[y * size + x]) parts.push(`M${x} ${y}h1v1h-1z`)
    }
  }
  return { size, d: parts.join('') }
}
