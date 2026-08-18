// upload-verified-prefix-match-images.mjs
// Run with: node scripts/upload-verified-prefix-match-images.mjs [--apply]
//
// Of the 77 "prefix match" candidates from the missing-image search (same
// base SKU code, ambiguous which color/variant), visually inspected each
// candidate photo and confirmed only 3 as genuinely correct:
//   - F286606-PUR ("Lilac Floral Paper w/ Gold Butterfly") <- F286606-Purp.jpg,
//     visually a lilac/purple butterfly paper, matches exactly
//   - P273811-60cm ("Shark Weighted Paw Companion Plush") <- P273811-2.png,
//     branded photo with SKU P273811 + UPC printed directly on it
//   - F286501-VIO ("Mom Plain Box Violet") <- "F286501-VT .png", branded
//     photo labeled "F286501-VT" on the packaging itself
// Everything else in the 77 was ruled out on visual inspection: wrong
// product entirely (F287413-BLK matched to an unrelated pouch photo),
// multi-color group/family shots that would misrepresent which color a
// customer is ordering (F102518, F287957, T641397, the whole F287456
// block), or simply the wrong color/size variant.
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

const MATCHES = {
  'F286606-PUR': 'C:/Users/Dragon/Downloads/livecatalog/livecatalog/data/images/recent-3mo-images/F286606-Purp.jpg',
  'P273811-60cm': 'C:/Users/Dragon/Downloads/02_Photos/6-16-26pics/P273811-2.png',
  'F286501-VIO': 'C:/Users/Dragon/Downloads/02_Photos/images/F286501-VT .png',
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
