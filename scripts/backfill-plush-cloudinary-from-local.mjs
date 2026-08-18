// backfill-plush-cloudinary-from-local.mjs
// Run with: node scripts/backfill-plush-cloudinary-from-local.mjs [--apply]
//
// 4 of the 12 new plush products (Black Bear, Dairy Cow, Turtle,
// Axolotl-46cm) got their photo uploaded straight to Erply's CDN via
// saveProductPicture (push-new-plush-images-to-erply.mjs, local base64)
// but never went through Cloudinary/Supabase, unlike the other 8 -- an
// oversight, not intentional. Backfills that gap using the same local
// files, so these 4 can also be pushed to WooCommerce like the other 6
// (push-new-plush-images-to-woo.mjs).
//
// Defaults to a dry run; pass --apply to write.
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

const ITEMS = [
  { sku: 'P273812-60cm', file: 'C:/Users/Dragon/Downloads/02_Photos/6-16-26pics/P273812.jpg' },
  { sku: 'P273815-60cm', file: 'C:/Users/Dragon/Downloads/02_Photos/6-16-26pics/P273815.jpg' },
  { sku: 'P273805-60cm', file: 'C:/Users/Dragon/Downloads/02_Photos/images/P273805-60.png' },
  { sku: 'P273816-46cm', file: 'C:/Users/Dragon/Downloads/02_Photos/images/P273816-46ccm.png' },
]

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
  for (const item of ITEMS) {
    if (!fs.existsSync(item.file)) { console.error(`ABORT: ${item.file} not found.`); process.exit(1) }
  }
  const { data: products, error } = await supabase.from('products').select('id, sku, image_url').in('sku', ITEMS.map((i) => i.sku))
  if (error) throw new Error(error.message)
  const bySku = new Map(products.map((p) => [p.sku, p]))
  for (const item of ITEMS) {
    const p = bySku.get(item.sku)
    if (!p) { console.error(`ABORT: ${item.sku} not found in Supabase.`); process.exit(1) }
    if (p.image_url) { console.error(`ABORT: ${item.sku} already has an image_url.`); process.exit(1) }
  }

  console.log(`${ITEMS.length} items to upload:`)
  for (const item of ITEMS) console.log(`  ${item.sku} <- ${item.file}`)

  if (!APPLY) {
    console.log('\nDry run only -- pass --apply to upload + write.')
    return
  }

  for (const item of ITEMS) {
    const p = bySku.get(item.sku)
    try {
      const secureUrl = await uploadToCloudinary(item.file, item.sku)
      const { error: updateErr } = await supabase
        .from('products')
        .update({ image_url: secureUrl, image_urls: [secureUrl], needs_photo: false })
        .eq('id', p.id)
      if (updateErr) throw new Error(updateErr.message)
      console.log(`  ${item.sku}: uploaded -> ${secureUrl}`)
    } catch (err) {
      console.error(`  FAILED ${item.sku}: ${err.message}`)
    }
  }

  console.log('\nIndependently re-fetching to confirm...')
  const { data: check } = await supabase.from('products').select('sku, image_url, needs_photo').in('sku', ITEMS.map((i) => i.sku))
  for (const row of check) console.log(`  ${row.sku}: image_url=${row.image_url} needs_photo=${row.needs_photo}`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
