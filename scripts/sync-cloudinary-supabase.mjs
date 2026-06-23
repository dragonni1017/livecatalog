// sync-cloudinary-supabase.mjs
// Run with: node scripts/sync-cloudinary-supabase.mjs [--dry-run]
// Rescans Cloudinary and updates products.image_url in Supabase, matched by SKU.
// Prefers non-"box" images when a SKU has multiple assets.

import https from 'https'
import { createClient } from '@supabase/supabase-js'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.local') })

const DRY_RUN = process.argv.includes('--dry-run')

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME
const API_KEY = process.env.CLOUDINARY_API_KEY
const API_SECRET = process.env.CLOUDINARY_API_SECRET
if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
  console.error('Missing Cloudinary credentials. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET in the environment (e.g. .env.local).')
  process.exit(1)
}
const AUTH = Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing Supabase env vars. Make sure .env.local is set up.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function fetchPage(nextCursor) {
  return new Promise((resolve, reject) => {
    const qs = new URLSearchParams({ max_results: '500' })
    if (nextCursor) qs.set('next_cursor', nextCursor)
    const options = {
      hostname: 'api.cloudinary.com',
      path: `/v1_1/${CLOUD_NAME}/resources/image?${qs}`,
      headers: { Authorization: `Basic ${AUTH}` },
    }
    https.get(options, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => resolve(JSON.parse(data)))
    }).on('error', reject)
  })
}

async function fetchAllImages() {
  let all = []
  let cursor = null
  do {
    const result = await fetchPage(cursor)
    if (result.error) {
      console.error('Cloudinary API error:', result.error.message)
      process.exit(1)
    }
    all = all.concat(result.resources || [])
    cursor = result.next_cursor || null
    console.log(`  Fetched ${all.length} images...`)
  } while (cursor)
  return all
}

// SKU is the public_id filename up to the first underscore: "F287154_lohw9m" -> "F287154"
function extractSku(publicId) {
  const filename = publicId.split('/').pop()
  const i = filename.indexOf('_')
  return (i > -1 ? filename.slice(0, i) : filename).toUpperCase()
}

async function fetchAllProducts() {
  const all = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('products')
      .select('id, sku, image_url')
      .range(from, from + PAGE - 1)
    if (error) { console.error('Supabase read error:', error.message); process.exit(1) }
    all.push(...data)
    if (data.length < PAGE) break
  }
  return all
}

async function main() {
  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Rescanning Cloudinary...`)
  const images = await fetchAllImages()
  console.log(`\nTotal images found: ${images.length}`)

  // Build SKU -> URL map, preferring non-box images
  const skuToUrl = {}
  const skuIsBox = {}
  for (const img of images) {
    const filename = img.public_id.split('/').pop()
    const sku = extractSku(img.public_id)
    const isBox = /_(box)(_|$)/i.test(filename)
    if (!skuToUrl[sku]) {
      skuToUrl[sku] = img.secure_url
      skuIsBox[sku] = isBox
    } else if (skuIsBox[sku] && !isBox) {
      skuToUrl[sku] = img.secure_url
      skuIsBox[sku] = false
    }
  }
  console.log(`Unique SKUs in Cloudinary: ${Object.keys(skuToUrl).length}`)

  const products = await fetchAllProducts()
  console.log(`Products in Supabase: ${products.length}`)

  // Determine which products need an update
  const toUpdate = []
  let alreadyCorrect = 0
  let noImage = 0
  for (const p of products) {
    const url = skuToUrl[(p.sku || '').toUpperCase()]
    if (!url) { noImage++; continue }
    if (p.image_url === url) { alreadyCorrect++; continue }
    toUpdate.push({ id: p.id, sku: p.sku, image_url: url })
  }

  console.log(`\nMatched & already up to date: ${alreadyCorrect}`)
  console.log(`No Cloudinary image:          ${noImage}`)
  console.log(`To update:                    ${toUpdate.length}`)

  if (toUpdate.length === 0) {
    console.log('\nNothing to update. Done.')
    return
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Sample of changes (first 20):')
    toUpdate.slice(0, 20).forEach((u) => console.log(`  ${u.sku} -> ${u.image_url}`))
    console.log('\n[DRY RUN] No writes performed. Re-run without --dry-run to apply.')
    return
  }

  const now = new Date().toISOString()
  let updated = 0
  for (const u of toUpdate) {
    const { error } = await supabase
      .from('products')
      .update({ image_url: u.image_url, updated_at: now })
      .eq('id', u.id)
    if (error) {
      console.error(`  Failed ${u.sku}: ${error.message}`)
    } else {
      updated++
    }
  }

  console.log(`\n✅ Done! Updated ${updated} of ${toUpdate.length} products with Cloudinary images.`)
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
