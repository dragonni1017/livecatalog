// download-erply-images.mjs
// Run with: node scripts/download-erply-images.mjs
//
// Pulls product images directly from Erply (getProducts with getImages=1) for
// every SKU that currently has no image_url in Supabase, and downloads the
// best-available image to data/images/erply-images/<SKU>.<ext>, writing a
// mapping CSV at data/images/erply-image-mapping.csv (same sku,filename shape
// as the godaddy backfill mapping CSV).
//
// IMPORTANT -- this script only downloads. Per Erply's own API docs
// (learn-api.erply.com/requests/getproducts), product picture URLs "must not
// be hotlinked -- you need to download the images to your application and
// serve them from there." Do not point image_url at Erply's returned URLs
// directly. Run scripts/upload-images-to-cloudinary.mjs afterwards, passing
// this script's output dir/mapping CSV as arguments, to push the downloaded
// files to Cloudinary and update Supabase -- that's the only step allowed to
// serve them publicly:
//
//   node scripts/upload-images-to-cloudinary.mjs \
//     data/images/erply-images data/images/erply-image-mapping.csv \
//     data/images/erply-cloudinary-upload-log.csv
//
// Requires in .env.local:
//   ERPLY_CLIENT_CODE / ERPLY_USERNAME / ERPLY_PASSWORD
//   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
//
// Erply's product image fields are "not accessible by default" -- Erply
// support has to enable image API access on the account first, or every
// image in the response will be empty/unreachable even though the API call
// itself succeeds.
//
// Note: Erply's documented `images` array (getProducts / getProductPictures)
// has no "isPrimary" field -- fields are pictureID, name, thumbURL, smallURL,
// largeURL, fullURL, external, hostingProvider, hash, tenant. This script
// just takes images[0] (Erply's own listed order) as the product's photo.
//
// This has to run on your machine, not in the sandbox this was generated in --
// same reason as the other backfill scripts: Erply's API domain isn't reachable
// from that sandbox's network allowlist.

import fs from 'fs'
import path from 'path'
import https from 'https'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

config({ path: path.join(ROOT, '.env.local') })

const ERPLY_CLIENT_CODE = process.env.ERPLY_CLIENT_CODE
const ERPLY_USERNAME = process.env.ERPLY_USERNAME
const ERPLY_PASSWORD = process.env.ERPLY_PASSWORD
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!ERPLY_CLIENT_CODE || !ERPLY_USERNAME || !ERPLY_PASSWORD) {
  console.error('Missing Erply credentials in .env.local (ERPLY_CLIENT_CODE / ERPLY_USERNAME / ERPLY_PASSWORD).')
  process.exit(1)
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing Supabase credentials in .env.local (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const IMAGES_DIR = path.join(ROOT, 'data', 'images', 'erply-images')
const MAPPING_CSV = path.join(ROOT, 'data', 'images', 'erply-image-mapping.csv')
const MISSING_CSV = path.join(ROOT, 'data', 'images', 'erply-skus-still-missing-image.csv')

const API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`
const PAGE_SIZE = 300

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Windows locks files open in Excel/Explorer preview -- retry instead of
// crashing on EBUSY/EPERM, matching the other backfill scripts' behavior.
async function writeFileSafe(filePath, content, { append = false } = {}) {
  const attempts = 5
  for (let i = 1; i <= attempts; i++) {
    try {
      if (append) fs.appendFileSync(filePath, content)
      else fs.writeFileSync(filePath, content)
      return true
    } catch (err) {
      if ((err.code === 'EBUSY' || err.code === 'EPERM') && i < attempts) {
        await sleep(500 * i)
        continue
      }
      console.warn(`WARNING: could not write ${filePath} (${err.code || err.message}). Close it if open elsewhere.`)
      return false
    }
  }
  return false
}

// ---- Erply auth + product fetch (mirrors lib/erply.ts's real-mode logic) ----

async function erplyPost(params) {
  const body = new URLSearchParams({ clientCode: ERPLY_CLIENT_CODE, ...params })
  const res = await fetch(API_URL, { method: 'POST', body })
  if (!res.ok) throw new Error(`Erply HTTP ${res.status}`)
  const json = await res.json()
  if (json.status?.responseStatus === 'error') {
    throw new Error(`Erply error ${json.status.errorCode}: ${json.status.errorField ?? 'unknown'}`)
  }
  return json
}

async function getSessionKey() {
  const data = await erplyPost({
    request: 'verifyUser',
    username: ERPLY_USERNAME,
    password: ERPLY_PASSWORD,
  })
  return data.records[0].sessionKey
}

async function fetchProductPage(sessionKey, pageNo) {
  const data = await erplyPost({
    request: 'getProducts',
    sessionKey,
    recordsOnPage: String(PAGE_SIZE),
    pageNo: String(pageNo),
    getImages: '1',
    active: '1',
  })
  return { products: data.records, total: data.status.recordsTotal ?? 0 }
}

async function getAllErplyProducts() {
  const sessionKey = await getSessionKey()
  const first = await fetchProductPage(sessionKey, 1)
  const all = [...first.products]
  const total = first.total
  // Don't precompute totalPages from PAGE_SIZE -- confirmed live that Erply
  // silently caps each page below the requested recordsOnPage under some
  // params (e.g. getStockInfo=1 caps at 200 regardless of what's requested),
  // which would undercount pages needed and truncate results. Loop by actual
  // accumulated count instead; a short/empty page ends it as a safety net.
  let page = 2
  while (all.length < total) {
    const { products } = await fetchProductPage(sessionKey, page)
    if (products.length === 0) break
    all.push(...products)
    process.stdout.write(`  fetched page ${page}, ${all.length}/${total} so far\n`)
    page++
  }
  return all
}

// ---- Download ----

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          download(res.headers.location, destPath).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`))
          return
        }
        const contentType = res.headers['content-type'] || ''
        if (!contentType.startsWith('image/')) {
          reject(new Error(`unexpected content-type: ${contentType}`))
          return
        }
        const file = fs.createWriteStream(destPath)
        res.pipe(file)
        file.on('finish', () => file.close(resolve))
        file.on('error', reject)
      })
      .on('error', reject)
  })
}

function extFromUrl(url) {
  const m = url.match(/\.(png|jpe?g|webp|gif)\b/i)
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg'
}

async function main() {
  console.log('Loading SKUs missing an image in Supabase...')
  const missingSkus = new Set()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('products')
      .select('sku')
      .is('image_url', null)
      .range(from, from + PAGE - 1)
    if (error) {
      console.error('Failed to load products:', error.message)
      process.exit(1)
    }
    data.forEach((r) => r.sku && missingSkus.add(r.sku.toUpperCase()))
    if (data.length < PAGE) break
  }
  console.log(`  ${missingSkus.size} SKUs currently have no image_url`)

  fs.mkdirSync(IMAGES_DIR, { recursive: true })
  const existingStems = new Set(
    fs.readdirSync(IMAGES_DIR).map((f) => path.parse(f).name.toUpperCase())
  )

  console.log('Fetching product + image data from Erply (this can take a while for a large catalog)...')
  const erplyProducts = await getAllErplyProducts()
  console.log(`  ${erplyProducts.length} active products returned`)

  const mappingLines = []
  const stillMissing = []
  let downloaded = 0
  let skippedLocal = 0
  let noImageInErply = 0
  let notNeeded = 0
  let failed = 0

  for (const p of erplyProducts) {
    const sku = (p.code || String(p.productID)).trim()
    if (!sku) continue
    if (!missingSkus.has(sku.toUpperCase())) {
      notNeeded++ // already has a working image in Supabase -- skip
      continue
    }
    const image = p.images?.[0] // no documented "isPrimary" flag -- first listed image
    const sourceUrl = image?.fullURL || image?.largeURL
    if (!sourceUrl) {
      noImageInErply++
      stillMissing.push(sku)
      continue
    }
    if (existingStems.has(sku.toUpperCase())) {
      skippedLocal++
      continue
    }
    const ext = extFromUrl(sourceUrl)
    const filename = `${sku}.${ext}`
    const dest = path.join(IMAGES_DIR, filename)
    try {
      await download(sourceUrl, dest)
      mappingLines.push(`${sku},${filename}`)
      downloaded++
      process.stdout.write(`OK   ${sku}\n`)
    } catch (err) {
      if (fs.existsSync(dest)) fs.unlinkSync(dest)
      stillMissing.push(sku)
      failed++
      process.stdout.write(`FAIL ${sku}: ${err.message}\n`)
    }
  }

  if (mappingLines.length) {
    await writeFileSafe(MAPPING_CSV, mappingLines.join('\n') + '\n', { append: fs.existsSync(MAPPING_CSV) })
  }
  if (stillMissing.length) {
    await writeFileSafe(MISSING_CSV, 'sku\n' + stillMissing.join('\n') + '\n')
  }

  console.log(
    `\nDone. downloaded=${downloaded} skipped_local(already on disk)=${skippedLocal} not_needed(already has image in Supabase)=${notNeeded} no_image_in_erply=${noImageInErply} failed=${failed}`
  )
  console.log(`Mapping written to ${MAPPING_CSV}`)
  console.log(
    `Next: node scripts/upload-images-to-cloudinary.mjs "${IMAGES_DIR}" "${MAPPING_CSV}"`
  )
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
