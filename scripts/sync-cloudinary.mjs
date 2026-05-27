// sync-cloudinary.mjs
// Run with: node scripts/sync-cloudinary.mjs
// Updates lib/products-data.json with Cloudinary image URLs matched by SKU

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

// Extract the SKU from a Cloudinary public_id like "F287154_lohw9m"
function extractSku(publicId) {
  // public_id may include folder prefix — take just the filename part
  const filename = publicId.split('/').pop()
  // SKU is everything before the first underscore
  const underscoreIdx = filename.indexOf('_')
  return underscoreIdx > -1 ? filename.slice(0, underscoreIdx) : filename
}

async function main() {
  console.log('Fetching images from Cloudinary...')
  const images = await fetchAllImages()
  console.log(`\nTotal images found: ${images.length}`)

  // Build a map: SKU (uppercase) -> secure_url
  // Prefer non-Box images: only overwrite if current entry is a Box image
  const skuToUrl = {}
  const skuIsBox = {}
  for (const img of images) {
    const filename = img.public_id.split('/').pop()
    const sku = extractSku(img.public_id).toUpperCase()
    const isBox = /_(box|BOX)(_|$)/.test(filename)

    if (!skuToUrl[sku]) {
      // First image for this SKU — take it
      skuToUrl[sku] = img.secure_url
      skuIsBox[sku] = isBox
    } else if (skuIsBox[sku] && !isBox) {
      // We had a Box image, but now found a non-Box — prefer this one
      skuToUrl[sku] = img.secure_url
      skuIsBox[sku] = false
    }
    // If we already have a non-Box image, keep it
  }

  // Load products-data.json
  const dataPath = path.join(__dirname, '..', 'lib', 'products-data.json')
  const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'))

  let matched = 0
  let unmatched = 0

  const updatedProducts = data.products.map((product) => {
    const sku = (product.sku || '').toUpperCase()
    const url = skuToUrl[sku]
    if (url) {
      matched++
      return { ...product, image_url: url }
    } else {
      unmatched++
      return product
    }
  })

  // Write updated data back
  const updated = { ...data, products: updatedProducts }
  fs.writeFileSync(dataPath, JSON.stringify(updated, null, 2))

  console.log(`\n✅ Done!`)
  console.log(`   Matched:   ${matched} products got a Cloudinary URL`)
  console.log(`   Unmatched: ${unmatched} products had no matching image`)
  console.log(`\nlib/products-data.json has been updated.`)
  console.log(`Run "git add lib/products-data.json && git commit -m \\"add cloudinary images\\"" to save.`)
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
