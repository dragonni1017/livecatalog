// upload-new-plush-photos.mjs
// Run with: node scripts/upload-new-plush-photos.mjs [--apply]
//
// 5 of the 12 new plush products (see push-new-plush-to-supabase.mjs) have
// a matching local photo already sitting in Downloads/02_Photos/images/.
// Uploads those to Cloudinary (same public_id = SKU convention as
// upload-images-to-cloudinary.mjs) and sets image_url/image_urls +
// needs_photo=false on the matching Supabase row.
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

const PHOTOS_DIR = 'C:/Users/Dragon/Downloads/02_Photos/images'
const MATCHES = [
  { sku: 'P273798-46cm', file: 'P273798-46cm.png' },
  { sku: 'P273800-46cm', file: 'P273800-46cm.png' },
  { sku: 'P273802-46cm', file: 'P273802-46cm.png' },
  { sku: 'P273807-46cm', file: 'P273807-46cm.png' },
  { sku: 'P273810-46cm', file: 'P273810-46cm.png' },
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
  console.log(`${MATCHES.length} candidate photo matches:`)
  for (const m of MATCHES) {
    const filePath = path.join(PHOTOS_DIR, m.file)
    const exists = fs.existsSync(filePath)
    console.log(`  ${m.sku} -> ${m.file} (${exists ? 'found' : 'MISSING on disk'})`)
    if (!exists) {
      console.error(`ABORT: ${filePath} not found.`)
      process.exit(1)
    }
  }

  const { data: products, error } = await supabase
    .from('products')
    .select('id, sku, image_url')
    .in('sku', MATCHES.map((m) => m.sku))
  if (error) throw new Error(error.message)
  const bySku = new Map(products.map((p) => [p.sku, p]))
  for (const m of MATCHES) {
    const p = bySku.get(m.sku)
    if (!p) { console.error(`ABORT: ${m.sku} not found in Supabase.`); process.exit(1) }
    if (p.image_url) { console.error(`ABORT: ${m.sku} already has an image_url (${p.image_url}) -- refusing to overwrite.`); process.exit(1) }
  }
  console.log('\nConfirmed: all 5 SKUs exist in Supabase with no existing image_url.')

  if (!APPLY) {
    console.log('\nDry run only -- pass --apply to upload + write these.')
    return
  }

  for (const m of MATCHES) {
    const filePath = path.join(PHOTOS_DIR, m.file)
    const p = bySku.get(m.sku)
    try {
      const secureUrl = await uploadToCloudinary(filePath, m.sku)
      const { error: updateErr } = await supabase
        .from('products')
        .update({ image_url: secureUrl, image_urls: [secureUrl], needs_photo: false })
        .eq('id', p.id)
      if (updateErr) throw new Error(updateErr.message)
      console.log(`  ${m.sku}: uploaded -> ${secureUrl}`)
    } catch (err) {
      console.error(`  FAILED ${m.sku}: ${err.message}`)
    }
  }

  console.log('\nIndependently re-fetching to confirm...')
  const { data: check } = await supabase.from('products').select('sku, image_url, needs_photo').in('sku', MATCHES.map((m) => m.sku))
  for (const row of check) console.log(`  ${row.sku}: image_url=${row.image_url} needs_photo=${row.needs_photo}`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
