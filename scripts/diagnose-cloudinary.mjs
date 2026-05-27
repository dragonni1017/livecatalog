// diagnose-cloudinary.mjs
// Run with: node scripts/diagnose-cloudinary.mjs
// Shows why SKUs aren't matching between products-data.json and Cloudinary

import https from 'https'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const CLOUD_NAME = 'dohwdv0ys'
const API_KEY = '768287939643921'
const API_SECRET = '4GfJwmB4mYqQPg1Y61pJiFD0Cjk'
const AUTH = Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64')

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
    all = all.concat(result.resources || [])
    cursor = result.next_cursor || null
  } while (cursor)
  return all
}

async function main() {
  console.log('Fetching images from Cloudinary...')
  const images = await fetchAllImages()

  // Show first 20 raw public_ids from Cloudinary
  console.log('\n--- Sample Cloudinary public_ids (first 20) ---')
  images.slice(0, 20).forEach(img => console.log(' ', img.public_id))

  // Load products
  const dataPath = path.join(__dirname, '..', 'lib', 'products-data.json')
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'))

  // Show first 20 product SKUs
  console.log('\n--- Sample product SKUs from products-data.json (first 20) ---')
  data.products.slice(0, 20).forEach(p => console.log(' ', p.sku))

  // Build cloudinary SKU map
  const skuToUrl = {}
  for (const img of images) {
    const filename = img.public_id.split('/').pop()
    const underscoreIdx = filename.indexOf('_')
    const sku = underscoreIdx > -1 ? filename.slice(0, underscoreIdx).toUpperCase() : filename.toUpperCase()
    skuToUrl[sku] = img.secure_url
  }

  // Show unmatched products and their SKUs
  const unmatched = data.products.filter(p => !skuToUrl[(p.sku || '').toUpperCase()])
  console.log(`\n--- Unmatched product SKUs (${unmatched.length} total, showing first 20) ---`)
  unmatched.slice(0, 20).forEach(p => console.log(' ', p.sku))

  // Show what Cloudinary SKUs look like that are close
  console.log('\n--- All unique Cloudinary SKU prefixes (first 30) ---')
  const cloudSkus = [...new Set(Object.keys(skuToUrl))].sort()
  cloudSkus.slice(0, 30).forEach(s => console.log(' ', s))
}

main().catch(console.error)
