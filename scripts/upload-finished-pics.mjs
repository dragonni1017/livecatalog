// upload-finished-pics.mjs
// Run with: node scripts/upload-finished-pics.mjs [--apply]
//
// Dragon dropped 57 files in Downloads/Finished pics/ (professionally
// finished product photography). Filename-matched (case-insensitive,
// basename = SKU) against all Supabase products: 41 matched an existing
// product, 39 of which already had an image on file. Dragon's call:
// replace all 41 (including the 39 that already had a photo), and leave
// the 14 non-matching files alone (they don't exist in Supabase or Erply
// either -- likely an unreleased product line, out of scope here).
//
// Uploads to Cloudinary + Supabase image_url/image_urls only -- does NOT
// push to Erply CDN or WooCommerce (same phased approach used earlier
// this session; check/push those separately once this is confirmed).
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

const PICS_DIR = 'C:\\Users\\Dragon\\Downloads\\Finished pics'

// sku -> filename in PICS_DIR (K229473 has both .jpeg/.png on disk; using
// the larger .png master). Case in filename doesn't matter on Windows.
const MATCHES = {
  'K229361': 'K229361.png', 'K229390': 'K229390.png', 'K229391': 'K229391.png',
  'K229392': 'K229392.png', 'K229396': 'K229396.png', 'K229397': 'K229397.png',
  'K229407': 'K229407.png', 'K229408': 'K229408.png', 'K229410': 'K229410.png',
  'K229421': 'K229421.png', 'K229423': 'K229423.png', 'K229424': 'K229424.png',
  'K229426': 'K229426.png', 'K229427': 'K229427.png', 'K229428': 'K229428.png',
  'K229430': 'K229430.png', 'K229431': 'K229431.png', 'K229435': 'K229435.png',
  'K229438': 'K229438.png', 'K229440': 'K229440.png', 'K229446': 'K229446.png',
  'K229447': 'K229447.png', 'K229464': 'K229464.png', 'K229465': 'K229465.png',
  'K229466': 'K229466.png', 'K229472': 'K229472.png', 'K229473': 'K229473.png',
  'K229475': 'K229475.png', 'K229481': 'K229481.png', 'K229482': 'K229482.png',
  'K229483': 'K229483.png', 'K229486': 'K229486.png', 'K229487': 'K229487.png',
  'K229488': 'K229488.png', 'P257011': 'P257011.jpeg', 'P257053': 'P257053.jpeg',
  'P257091': 'P257091.jpeg', 'P257151': 'P257151.png', 'P257192': 'P257192.jpeg',
  'P273761': 'P273761.png', 'T641291': 'T641291.png',
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
    const filePath = path.join(PICS_DIR, MATCHES[sku])
    if (!fs.existsSync(filePath)) { console.error(`ABORT: ${filePath} not found.`); process.exit(1) }
  }

  const { data: products, error } = await supabase.from('products').select('id, sku, name, image_url').in('sku', skus)
  if (error) throw new Error(error.message)
  const bySku = new Map(products.map((p) => [p.sku, p]))
  for (const sku of skus) {
    if (!bySku.get(sku)) { console.error(`ABORT: ${sku} not found in Supabase.`); process.exit(1) }
  }

  console.log(`${skus.length} products to upload (replacing existing image where present):`)
  for (const sku of skus) {
    const p = bySku.get(sku)
    console.log(`  ${sku} "${p.name}" <- ${MATCHES[sku]} ${p.image_url ? '(replaces existing)' : '(fills gap)'}`)
  }

  if (!APPLY) {
    console.log('\nDry run only -- pass --apply to upload + write.')
    return
  }

  for (const sku of skus) {
    const p = bySku.get(sku)
    try {
      const secureUrl = await uploadToCloudinary(path.join(PICS_DIR, MATCHES[sku]), sku)
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
