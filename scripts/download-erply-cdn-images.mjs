// download-erply-cdn-images.mjs
// Run with: node scripts/download-erply-cdn-images.mjs
//
// Downloads product images from Erply's CDN for every SKU that currently has
// no image_url in Supabase but DOES have a live, non-deleted image on Erply's
// CDN -- the ~1,046-SKU gap identified by
// scripts/export-erply-cdn-images-inventory.mjs (2026-08-17).
//
// IMPORTANT: does NOT use getProducts' embedded `images` field -- confirmed
// live that it badly under-reports (only 4/2871 products show an image
// through it, vs. 1,903 distinct products actually on the CDN). Uses the
// CDN's own listing endpoint instead (GET https://cdn.erply.com/images,
// paginated, keyed by productId, context "erply-product"), same as the
// export script. See docs/memory/project-erply-image-backfill.md.
//
// This script only downloads -- per Erply's API docs, product picture URLs
// must not be hotlinked into image_url directly. Run
// scripts/upload-images-to-cloudinary.mjs afterwards (prints the exact
// command at the end) to push these to Cloudinary and update Supabase --
// that's the only step allowed to serve them publicly.
//
// Requires in .env.local:
//   ERPLY_CLIENT_CODE / ERPLY_USERNAME / ERPLY_PASSWORD
//   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
//
// Writes:
//   data/images/erply-cdn-images/<SKU>.<ext>
//   data/images/erply-cdn-image-mapping.csv          (header: sku,image_filename
//     -- required by upload-images-to-cloudinary.mjs's parser)
//   data/images/erply-cdn-skus-still-missing.csv
//
// This has to run on your machine, not in a sandbox -- Erply's API domain
// isn't network-allowlisted there, same as the other Erply backfill scripts.

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

const missing = []
if (!ERPLY_CLIENT_CODE) missing.push('ERPLY_CLIENT_CODE')
if (!ERPLY_USERNAME) missing.push('ERPLY_USERNAME')
if (!ERPLY_PASSWORD) missing.push('ERPLY_PASSWORD')
if (!SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL')
if (!SUPABASE_SERVICE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')
if (missing.length > 0) {
  console.error(`Missing in .env.local: ${missing.join(', ')}`)
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const IMAGES_DIR = path.join(ROOT, 'data', 'images', 'erply-cdn-images')
const MAPPING_CSV = path.join(ROOT, 'data', 'images', 'erply-cdn-image-mapping.csv')
const MISSING_CSV = path.join(ROOT, 'data', 'images', 'erply-cdn-skus-still-missing.csv')

const API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Windows locks files open in Excel/Explorer preview -- retry instead of
// crashing on EBUSY/EPERM, matching the other backfill scripts.
async function writeFileSafe(filePath, content) {
  const attempts = 5
  for (let i = 1; i <= attempts; i++) {
    try {
      fs.writeFileSync(filePath, content)
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

// ---- Erply auth + product fetch ----

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

async function verifyUser() {
  const auth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  return { sessionKey: auth.records[0].sessionKey, jwt: auth.records[0].token }
}

async function fetchErplyProducts(sessionKey) {
  // Erply caps each page at 200 records whenever getStockInfo=1 is passed
  // regardless of recordsOnPage -- not requesting stock here, but keep the
  // same "loop until recordsTotal" logic since page caps have been
  // inconsistent across params before.
  async function page(pageNo) {
    const data = await erplyPost({
      request: 'getProducts',
      sessionKey,
      recordsOnPage: '300',
      pageNo: String(pageNo),
      active: '1',
    })
    return { products: data.records, total: data.status.recordsTotal ?? 0 }
  }
  const first = await page(1)
  const all = [...first.products]
  const total = first.total
  let pageNo = 2
  while (all.length < total) {
    const { products } = await page(pageNo)
    if (products.length === 0) break
    all.push(...products)
    pageNo++
  }
  return all
}

// productId -> primary image key (order 1 preferred), non-deleted,
// context "erply-product" only (the one confirmed to actually count).
async function fetchCdnPrimaryImageKeyByProductId(jwt) {
  const byProductId = new Map()
  let pageNo = 1
  let total = Infinity
  let seen = 0
  while (seen < total) {
    const res = await fetch(`https://cdn.erply.com/images?page=${pageNo}`, { headers: { JWT: jwt } })
    if (!res.ok) throw new Error(`Erply CDN HTTP ${res.status} on page ${pageNo}`)
    const data = await res.json()
    total = data.totalRecords
    for (const img of data.images) {
      if (img.isDeleted || img.context !== 'erply-product') continue
      const current = byProductId.get(img.productId)
      if (!current || img.order === 1) byProductId.set(img.productId, img.key)
    }
    seen += data.images.length
    if (data.images.length === 0) break
    pageNo++
  }
  return byProductId
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

function extFromKey(key) {
  const m = key.match(/\.(png|jpe?g|webp|gif)$/i)
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
    data.forEach((r) => r.sku && missingSkus.add(r.sku.trim().toUpperCase()))
    if (data.length < PAGE) break
  }
  console.log(`  ${missingSkus.size} SKUs currently have no image_url`)

  fs.mkdirSync(IMAGES_DIR, { recursive: true })
  const existingStems = new Set(fs.readdirSync(IMAGES_DIR).map((f) => path.parse(f).name.toUpperCase()))

  console.log('Authenticating with Erply...')
  const { sessionKey, jwt } = await verifyUser()

  console.log('Fetching active Erply products (for productId -> SKU)...')
  const products = await fetchErplyProducts(sessionKey)
  console.log(`  ${products.length} active products`)

  console.log("Fetching Erply CDN image listing (paginated)...")
  const primaryKeyByProductId = await fetchCdnPrimaryImageKeyByProductId(jwt)
  console.log(`  ${primaryKeyByProductId.size} distinct products have a live image on the CDN`)

  const tenant = ERPLY_CLIENT_CODE

  const mappingLines = ['sku,image_filename']
  const stillMissing = []
  let downloaded = 0
  let skippedLocal = 0
  let noCdnImage = 0
  let notNeeded = 0
  let failed = 0

  for (const p of products) {
    const sku = (p.code || String(p.productID)).trim()
    if (!sku) continue
    if (!missingSkus.has(sku.toUpperCase())) {
      notNeeded++ // already has image_url in Supabase -- skip
      continue
    }
    const key = primaryKeyByProductId.get(p.productID)
    if (!key) {
      noCdnImage++ // in the "genuinely missing everywhere" bucket, not this script's job
      continue
    }
    const ext = extFromKey(key)
    const filename = `${sku}.${ext}`
    if (existingStems.has(sku.toUpperCase())) {
      skippedLocal++
      mappingLines.push(`${sku},${filename}`)
      continue
    }
    const dest = path.join(IMAGES_DIR, filename)
    const sourceUrl = `https://cdn.erply.com/assets/${tenant}/image/${key}`
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

  await writeFileSafe(MAPPING_CSV, mappingLines.join('\n') + '\n')
  if (stillMissing.length) {
    await writeFileSafe(MISSING_CSV, 'sku\n' + stillMissing.join('\n') + '\n')
  }

  console.log(
    `\nDone. downloaded=${downloaded} skipped_local(already on disk)=${skippedLocal} not_needed(already has image_url)=${notNeeded} no_cdn_image=${noCdnImage} failed=${failed}`
  )
  console.log(`Mapping written to ${MAPPING_CSV}`)
  console.log(`Next: node scripts/upload-images-to-cloudinary.mjs "${IMAGES_DIR}" "${MAPPING_CSV}" "${path.join(ROOT, 'data', 'images', 'erply-cdn-cloudinary-upload-log.csv')}"`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
