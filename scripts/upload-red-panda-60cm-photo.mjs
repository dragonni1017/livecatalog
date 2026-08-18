// upload-red-panda-60cm-photo.mjs
// Run with: node scripts/upload-red-panda-60cm-photo.mjs [--apply]
//
// Found Downloads/02_Photos/plushpics/redpanda.png during a broader search
// for the 3 still-missing photos from create-missing-plush-in-erply.mjs --
// it's the actual branded L&Y USA product card for P273798, UPC
// 737879103272 printed directly on the image, an exact match for
// P273798-60cm's barcode. Uploads it the same way as
// upload-new-plush-photos.mjs + push-new-plush-images-to-erply.mjs
// (Cloudinary -> Supabase -> Erply CDN via saveProductPicture), just for
// this one confirmed match. No usable file was found for P273810-60cm
// (Unicorn) or P273803-60cm (Highland Cow) -- not attempted here.
//
// Defaults to a dry run; pass --apply to write.
//
// Requires in .env.local:
//   CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD

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
const ERPLY_CLIENT_CODE = process.env.ERPLY_CLIENT_CODE
const ERPLY_USERNAME = process.env.ERPLY_USERNAME
const ERPLY_PASSWORD = process.env.ERPLY_PASSWORD

for (const [name, val] of Object.entries({ CLOUD_NAME, API_KEY, API_SECRET, SUPABASE_URL, SUPABASE_SERVICE_KEY, ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD })) {
  if (!val) { console.error(`Missing in .env.local: ${name}`); process.exit(1) }
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const ERPLY_API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`

const SKU = 'P273798-60cm'
const ERPLY_PRODUCT_ID = 2875
const FILE_PATH = 'C:/Users/Dragon/Downloads/02_Photos/plushpics/redpanda.png'
const CLOUDINARY_PUBLIC_ID = SKU

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

async function erplyPost(params) {
  const body = new URLSearchParams({ clientCode: ERPLY_CLIENT_CODE, ...params })
  const res = await fetch(ERPLY_API_URL, { method: 'POST', body })
  const json = await res.json()
  if (json.status?.responseStatus === 'error') throw new Error(`Erply error ${json.status.errorCode}: ${json.status.errorField ?? 'unknown'}`)
  return json
}

async function main() {
  if (!fs.existsSync(FILE_PATH)) { console.error(`ABORT: ${FILE_PATH} not found.`); process.exit(1) }

  const { data: product, error } = await supabase.from('products').select('id, sku, image_url').eq('sku', SKU).single()
  if (error || !product) { console.error(`ABORT: ${SKU} not found in Supabase.`); process.exit(1) }
  if (product.image_url) { console.error(`ABORT: ${SKU} already has an image_url -- refusing to overwrite.`); process.exit(1) }

  console.log(`Will upload ${FILE_PATH} for ${SKU} (Supabase id ${product.id}, Erply productID ${ERPLY_PRODUCT_ID}).`)

  if (!APPLY) {
    console.log('\nDry run only -- pass --apply to upload + write.')
    return
  }

  console.log('\nUploading to Cloudinary...')
  const secureUrl = await uploadToCloudinary(FILE_PATH, CLOUDINARY_PUBLIC_ID)
  console.log(`  -> ${secureUrl}`)

  console.log('Updating Supabase...')
  const { error: updateErr } = await supabase
    .from('products')
    .update({ image_url: secureUrl, image_urls: [secureUrl], needs_photo: false })
    .eq('id', product.id)
  if (updateErr) throw new Error(updateErr.message)
  console.log('  done')

  console.log('Uploading to Erply CDN...')
  const auth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  const jwt = auth.records[0].token
  const urlRes = await fetch('https://cdn.erply.com/images/urls', {
    method: 'POST',
    headers: { JWT: jwt, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ context: 'erply-product', product_id: ERPLY_PRODUCT_ID, sku: SKU, url: secureUrl, filename: `${SKU}.png` }] }),
  })
  const urlText = await urlRes.text()
  console.log(`  ${urlRes.ok ? 'OK' : 'FAILED'}: ${urlText.slice(0, 300)}`)

  console.log('\nIndependently re-fetching to confirm...')
  const { data: check } = await supabase.from('products').select('image_url, needs_photo').eq('sku', SKU).single()
  console.log(`  Supabase: image_url=${check.image_url} needs_photo=${check.needs_photo}`)
  const cdnRes = await fetch(`https://cdn.erply.com/images?productId=${ERPLY_PRODUCT_ID}`, { headers: { JWT: jwt } })
  const cdnJson = await cdnRes.json()
  console.log(`  Erply CDN: ${cdnJson.recordsReturned ?? 0} image(s)`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
