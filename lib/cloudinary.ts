import { createHash } from 'crypto'

/**
 * Signed Cloudinary upload, server-side.
 *
 * The same convention every photo script in this repo uses: public_id = SKU,
 * so a product's image URL is derivable from its SKU and a re-upload
 * overwrites rather than accumulating copies.
 *
 * Kept tiny and dependency-free on purpose -- the scripts sign the same way
 * with raw fetch, and adding the Cloudinary SDK for one endpoint would mean
 * two different upload paths to keep in step.
 */

export function isCloudinaryConfigured(): boolean {
  return Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET,
  )
}

/**
 * Cloudinary's upload signature: the params sorted and joined as k=v&k=v,
 * with the API secret appended, SHA-1'd. Exported for
 * /admin/api/cleanup/photo-signature, which signs browser-direct uploads so
 * file bytes never pass through a Vercel function (4.5 MB body limit). The
 * browser must send exactly the signed params -- any extra upload param has
 * to be signed too or Cloudinary rejects the request.
 */
export function signParams(params: Record<string, string | number>, apiSecret: string): string {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
  return createHash('sha1').update(toSign + apiSecret).digest('hex')
}

/** Uploads bytes under `publicId` and returns the secure URL. */
export async function uploadToCloudinary(
  bytes: ArrayBuffer | Uint8Array,
  publicId: string,
  fileName: string,
): Promise<string> {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET
  if (!cloudName || !apiKey || !apiSecret) throw new Error('Cloudinary is not configured')

  const timestamp = Math.floor(Date.now() / 1000)
  const form = new FormData()
  form.append('file', new Blob([bytes as BlobPart]), fileName)
  form.append('api_key', apiKey)
  form.append('timestamp', String(timestamp))
  form.append('public_id', publicId)
  form.append('signature', signParams({ public_id: publicId, timestamp }, apiSecret))

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
    method: 'POST',
    body: form,
  })
  const json = await res.json()
  if (!res.ok || json.error) throw new Error(json.error?.message || `Cloudinary HTTP ${res.status}`)
  return json.secure_url as string
}
