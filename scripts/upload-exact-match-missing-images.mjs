// upload-exact-match-missing-images.mjs
// Run with: node scripts/upload-exact-match-missing-images.mjs [--apply]
//
// Of the 902 active products with no image anywhere, a full-Downloads
// filename index found 31 with a local file whose basename exactly
// matches the SKU -- mostly sitting in a dedicated
// Downloads/02_Photos/ImageOrganization/ImageOrganization/_handoff/
// compressed_for_upload/ staging folder that looks like it was prepared
// for upload and never finished, plus a few in this repo's own
// data/images/imgur-upload/. All 31 SKUs are currently manually_hidden
// (no immediate customer-facing impact), but the match is unambiguous
// (exact filename = exact SKU) so this is safe data-completeness work.
//
// Uploads to Cloudinary + Supabase image_url only -- does NOT push to
// Erply CDN or WooCommerce, since these rows are hidden and several
// overlap with the duplicate-listing/cross-family-collision review from
// this session (still unresolved whether some of these SKUs should even
// stay active) -- not worth the extra write until that's settled.
//
// Defaults to a dry run; pass --apply to write. Independently re-fetches
// afterward to confirm.
//
// Requires in .env.local:
//   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const APPLY = process.argv.includes('--apply')

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME
const API_KEY = process.env.CLOUDINARY_API_KEY
const API_SECRET = process.env.CLOUDINARY_API_SECRET
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
for (const [name, val] of Object.entries({ CLOUD_NAME, API_KEY, API_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY })) {
  if (!val) { console.error(`Missing in .env.local: ${name}`); process.exit(1) }
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

// sku -> local file path (from the exact-filename match)
const MATCHES = {
  'F287043': 'C:/Users/Dragon/Downloads/02_Photos/ImageOrganization/ImageOrganization/_handoff/compressed_for_upload/F287043.webp',
  'T641664': 'C:/Users/Dragon/Downloads/02_Photos/ImageOrganization/ImageOrganization/_handoff/compressed_for_upload/T641664.webp',
  'T642065': 'C:/Users/Dragon/Downloads/livecatalog/livecatalog/data/images/imgur-upload/T642065.jpg',
  'F287639': 'C:/Users/Dragon/Downloads/02_Photos/ImageOrganization/ImageOrganization/_handoff/compressed_for_upload/F287639.webp',
  'T642005': 'C:/Users/Dragon/Downloads/02_Photos/ImageOrganization/ImageOrganization/_handoff/compressed_for_upload/T642005.webp',
  'F286547-PK': 'C:/Users/Dragon/Downloads/02_Photos/ImageOrganization/ImageOrganization/_handoff/compressed_for_upload/F286547-PK.webp',
  'F287044': 'C:/Users/Dragon/Downloads/02_Photos/ImageOrganization/ImageOrganization/_handoff/compressed_for_upload/F287044.webp',
  'F287045': 'C:/Users/Dragon/Downloads/02_Photos/ImageOrganization/ImageOrganization/_handoff/compressed_for_upload/F287045.webp',
  'T641081-s': 'C:/Users/Dragon/Downloads/02_Photos/ImageOrganization/ImageOrganization/_handoff/compressed_for_upload/T641081-s.jpg',
  'D751052-3D Egg': 'C:/Users/Dragon/Downloads/02_Photos/ImageOrganization/ImageOrganization/_handoff/compressed_for_upload/D751052-3D Egg.webp',
  'F286501-PK': 'C:/Users/Dragon/Downloads/02_Photos/images/F286501-PK.png',
  'F287279-Pp': 'C:/Users/Dragon/Downloads/02_Photos/ImageOrganization/ImageOrganization/_handoff/compressed_for_upload/F287279-Pp.webp',
  'P273677-M': 'C:/Users/Dragon/Downloads/livecatalog/livecatalog/data/images/imgur-upload/P273677-M.jpg',
  'F287635': 'C:/Users/Dragon/Downloads/02_Photos/ImageOrganization/ImageOrganization/_handoff/compressed_for_upload/F287635.webp',
  'F287456-LIGHT PINK': 'C:/Users/Dragon/Downloads/02_Photos/ImageOrganization/ImageOrganization/_handoff/compressed_for_upload/F287456-LIGHT PINK.webp',
  'T641640-Multi': 'C:/Users/Dragon/Downloads/02_Photos/ImageOrganization/ImageOrganization/_handoff/compressed_for_upload/T641640-Multi.webp',
  'F287567': 'C:/Users/Dragon/Downloads/02_Photos/ImageOrganization/ImageOrganization/_handoff/compressed_for_upload/F287567.webp',
  'T641664-Red': 'C:/Users/Dragon/Downloads/02_Photos/ImageOrganization/ImageOrganization/_handoff/compressed_for_upload/T641664-Red.webp',
  'F287497-1': 'C:/Users/Dragon/Downloads/02_Photos/ImageOrganization/ImageOrganization/_handoff/compressed_for_upload/F287497-1.webp',
  'T641545-1': 'C:/Users/Dragon/Downloads/02_Photos/ImageOrganization/ImageOrganization/_handoff/compressed_for_upload/T641545-1.webp',
  'P273673-L': 'C:/Users/Dragon/Downloads/02_Photos/ImageOrganization/ImageOrganization/_handoff/compressed_for_upload/P273673-L.jpg',
  'F287277-1': 'C:/Users/Dragon/Downloads/02_Photos/ImageOrganization/ImageOrganization/_handoff/compressed_for_upload/F287277-1.webp',
  'F287279-R': 'C:/Users/Dragon/Downloads/02_Photos/ImageOrganization/ImageOrganization/_handoff/compressed_for_upload/F287279-R.webp',
  'F287560': 'C:/Users/Dragon/Downloads/02_Photos/ImageOrganization/ImageOrganization/_handoff/compressed_for_upload/F287560.webp',
  'F287568': 'C:/Users/Dragon/Downloads/02_Photos/ImageOrganization/ImageOrganization/_handoff/compressed_for_upload/F287568.webp',
  'F287569': 'C:/Users/Dragon/Downloads/02_Photos/ImageOrganization/ImageOrganization/_handoff/compressed_for_upload/F287569.webp',
  'P273678-L': 'C:/Users/Dragon/Downloads/livecatalog/livecatalog/data/images/imgur-upload/P273678-L.jpg',
  'F287508': 'C:/Users/Dragon/Downloads/02_Photos/ImageOrganization/ImageOrganization/_handoff/compressed_for_upload/F287508.webp',
  'F287637': 'C:/Users/Dragon/Downloads/02_Photos/ImageOrganization/ImageOrganization/_handoff/compressed_for_upload/F287637.webp',
  'F287634': 'C:/Users/Dragon/Downloads/02_Photos/ImageOrganization/ImageOrganization/_handoff/compressed_for_upload/F287634.webp',
  'D701120-LB': 'C:/Users/Dragon/Downloads/02_Photos/ImageOrganization/ImageOrganization/_handoff/compressed_for_upload/D701120-LB.webp',
}

function signParams(params) {
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join('&')
  return crypto.createHash('sha1').update(toSign + API_SECRET).digest('hex')
}

async function uploadToCloudinary(filePath, publicId) {
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = signParams({ public_id: publicId, timestamp })
  const buffer = fs.readFileSync(filePath)
  const form = new FormData()
  form.append('file', new Blob([buffer]), path.basename(filePath))
  form.append('api_key', API_KEY)
  form.append('timestamp', String(timestamp))
  form.append('public_id', publicId)
  form.append('signature', signature)
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, { method: 'POST', body: form })
  const json = await res.json()
  if (!res.ok || json.error) throw new Error(json.error?.message || `HTTP ${res.status}`)
  return json.secure_url
}

async function main() {
  const skus = Object.keys(MATCHES)
  for (const sku of skus) {
    if (!fs.existsSync(MATCHES[sku])) { console.error(`ABORT: ${MATCHES[sku]} not found.`); process.exit(1) }
  }

  const { data: products, error } = await supabase.from('products').select('id, sku, image_url').in('sku', skus)
  if (error) throw new Error(error.message)
  const bySku = new Map(products.map((p) => [p.sku, p]))
  for (const sku of skus) {
    const p = bySku.get(sku)
    if (!p) { console.error(`ABORT: ${sku} not found in Supabase.`); process.exit(1) }
    if (p.image_url) { console.error(`ABORT: ${sku} already has an image_url.`); process.exit(1) }
  }

  console.log(`${skus.length} products to upload:`)
  for (const sku of skus) console.log(`  ${sku} <- ${MATCHES[sku]}`)

  if (!APPLY) {
    console.log('\nDry run only -- pass --apply to upload + write.')
    return
  }

  for (const sku of skus) {
    const p = bySku.get(sku)
    try {
      const secureUrl = await uploadToCloudinary(MATCHES[sku], sku)
      const { error: updateErr } = await supabase.from('products').update({ image_url: secureUrl, image_urls: [secureUrl], needs_photo: false }).eq('id', p.id)
      if (updateErr) throw new Error(updateErr.message)
      console.log(`  ${sku}: uploaded -> ${secureUrl}`)
    } catch (err) {
      console.error(`  FAILED ${sku}: ${err.message}`)
    }
  }

  console.log('\nIndependently re-fetching to confirm...')
  const { data: check } = await supabase.from('products').select('sku, image_url').in('sku', skus)
  for (const row of check) console.log(`  ${row.sku}: image_url=${row.image_url}`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
