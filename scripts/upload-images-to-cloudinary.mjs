// upload-images-to-cloudinary.mjs
// Run with: node scripts/upload-images-to-cloudinary.mjs
//
// Uploads the local backfill images in data/images/recent-3mo-images/ to the
// new Cloudinary account (credentials in .env.local) and, for every SKU that
// exists in the Supabase products table, updates that product's image_url
// (and image_urls) to the new Cloudinary secure_url.
//
// Only uploads SKUs that actually exist as a product row in Supabase --
// no point spending free-tier storage/bandwidth on the ~300 SKUs from the
// QB report that aren't in the catalog DB at all. When a SKU has more than
// one candidate local image (data/images/recent-3mo-image-mapping.csv), the
// smallest file is used, to go easy on the free tier.
//
// Safe to re-run: it fetches the current Cloudinary resource list first
// and skips any SKU that's already uploaded (Cloudinary public_id = SKU).
//
// This has to run on your machine, not in the sandbox this was generated
// in -- both the local image files and a fast connection to Cloudinary
// are needed, and reading many multi-MB images off the network-mounted
// project folder from that sandbox was too slow/flaky to be practical.
//
// Optional CLI args to point this at a different backfill batch (e.g. the
// Erply image pull) instead of the default godaddy recent-3mo paths:
//   node scripts/upload-images-to-cloudinary.mjs <imagesDir> <mappingCsv> [logCsv]

import fs from 'fs'
import path from 'path'
import https from 'https'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

config({ path: path.join(ROOT, '.env.local') })

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME
const API_KEY = process.env.CLOUDINARY_API_KEY
const API_SECRET = process.env.CLOUDINARY_API_SECRET
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
  console.error('Missing Cloudinary credentials in .env.local (CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET).')
  process.exit(1)
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing Supabase credentials in .env.local (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

const IMAGES_DIR = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(ROOT, 'data', 'images', 'recent-3mo-images')
const MAPPING_CSV = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(ROOT, 'data', 'images', 'recent-3mo-image-mapping.csv')
const LOG_CSV = process.argv[4]
  ? path.resolve(process.argv[4])
  : path.join(ROOT, 'data', 'images', 'cloudinary-upload-log.csv')

function parseCsvLine(line) {
  const fields = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      fields.push(cur)
      cur = ''
    } else {
      cur += ch
    }
  }
  fields.push(cur)
  return fields
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
  const header = parseCsvLine(lines[0])
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line)
    const row = {}
    header.forEach((h, i) => (row[h] = cols[i]))
    return row
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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

// ---- Cloudinary: list existing resources (to skip already-uploaded SKUs) ----
function fetchCloudinaryPage(nextCursor) {
  return new Promise((resolve, reject) => {
    const AUTH = Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64')
    const qs = new URLSearchParams({ max_results: '500' })
    if (nextCursor) qs.set('next_cursor', nextCursor)
    const options = {
      hostname: 'api.cloudinary.com',
      path: `/v1_1/${CLOUD_NAME}/resources/image?${qs}`,
      headers: { Authorization: `Basic ${AUTH}` },
    }
    https
      .get(options, (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => {
          try {
            resolve(JSON.parse(data))
          } catch (e) {
            reject(e)
          }
        })
      })
      .on('error', reject)
  })
}

async function fetchAllCloudinaryPublicIds() {
  let all = []
  let cursor = null
  do {
    const result = await fetchCloudinaryPage(cursor)
    if (result.error) throw new Error(result.error.message)
    all = all.concat((result.resources || []).map((r) => r.public_id))
    cursor = result.next_cursor || null
  } while (cursor)
  return new Set(all)
}

// ---- Cloudinary: signed upload ----
function signParams(params) {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')
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

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/image/upload`, {
    method: 'POST',
    body: form,
  })
  const json = await res.json()
  if (!res.ok || json.error) {
    throw new Error(json.error?.message || `HTTP ${res.status}`)
  }
  return json.secure_url
}

async function main() {
  if (!fs.existsSync(MAPPING_CSV)) {
    console.error(`Missing ${MAPPING_CSV}`)
    process.exit(1)
  }

  console.log('Loading products from Supabase...')
  // Supabase/PostgREST caps unbounded selects at 1000 rows by default, and this
  // table has 3016 -- paginate with .range() or we silently only see the first
  // 1000 and treat every SKU past that as "not in the DB".
  const products = []
  const PAGE_SIZE = 1000
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error: prodErr } = await supabase
      .from('products')
      .select('id, sku')
      .range(from, from + PAGE_SIZE - 1)
    if (prodErr) {
      console.error('Failed to load products:', prodErr.message)
      process.exit(1)
    }
    products.push(...data)
    if (data.length < PAGE_SIZE) break
  }
  const skuToIds = new Map()
  for (const p of products) {
    const key = (p.sku || '').toUpperCase()
    if (!key) continue
    if (!skuToIds.has(key)) skuToIds.set(key, [])
    skuToIds.get(key).push(p.id)
  }
  console.log(`  ${products.length} products loaded, ${skuToIds.size} unique SKUs`)

  console.log('Checking already-uploaded images on Cloudinary...')
  const existingPublicIds = await fetchAllCloudinaryPublicIds()
  console.log(`  ${existingPublicIds.size} images already present`)

  const rows = parseCsv(fs.readFileSync(MAPPING_CSV, 'utf8'))

  // The mapping CSV's image_filename extension frequently doesn't match what's
  // actually on disk (e.g. CSV says "K229441.png" but the real file is
  // "K229441.jpg" -- files were normalized to .jpg at some point without the
  // CSV being regenerated). Match by basename (extension-agnostic) against an
  // index of what's actually in IMAGES_DIR, instead of trusting the CSV's
  // literal filename.
  const diskBasenameToFile = new Map()
  for (const f of fs.readdirSync(IMAGES_DIR)) {
    diskBasenameToFile.set(path.parse(f).name.toUpperCase(), f)
  }

  // group by sku, only keep skus that exist in the DB, pick smallest file per sku
  const bySku = new Map()
  const missingLocalFile = new Set()
  const candidateSkusInDb = new Set()
  for (const row of rows) {
    const sku = row.sku
    if (!sku) continue
    const skuUpper = sku.toUpperCase()
    if (!skuToIds.has(skuUpper)) continue // not in DB, skip -- saves free-tier space
    candidateSkusInDb.add(sku)
    const csvBase = path.parse(row.image_filename || '').name.toUpperCase()
    const actualFile = diskBasenameToFile.get(csvBase)
    const filePath = actualFile ? path.join(IMAGES_DIR, actualFile) : path.join(IMAGES_DIR, row.image_filename)
    if (!fs.existsSync(filePath)) {
      missingLocalFile.add(sku)
      continue
    }
    missingLocalFile.delete(sku) // a different row for the same sku did resolve
    const size = fs.statSync(filePath).size
    const current = bySku.get(sku)
    if (!current || size < current.size) {
      bySku.set(sku, { filePath, size })
    }
  }
  console.log(`  ${candidateSkusInDb.size} SKUs are in the DB and listed in the mapping CSV`)
  console.log(`  ${bySku.size} of those have a local file that actually exists on disk`)
  if (missingLocalFile.size) {
    console.log(`  ${missingLocalFile.size} SKUs are in the mapping CSV but the local file is MISSING on this machine (likely not synced from OneDrive yet):`)
    console.log('    ' + [...missingLocalFile].slice(0, 15).join(', ') + (missingLocalFile.size > 15 ? ', ...' : ''))
  }

  const logLines = ['sku,status,detail']
  for (const sku of missingLocalFile) {
    logLines.push(`${sku},missing_local_file,`)
  }
  let uploaded = 0
  let skippedExisting = 0
  let failed = 0
  let dbUpdated = 0

  for (const [sku, { filePath }] of bySku) {
    const publicId = sku // Cloudinary sanitizes public_ids; slashes would create folders, ours have none
    let secureUrl = null

    if (existingPublicIds.has(publicId)) {
      skippedExisting++
      secureUrl = `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${publicId}`
      logLines.push(`${sku},skipped_existing,`)
    } else {
      try {
        secureUrl = await uploadToCloudinary(filePath, publicId)
        uploaded++
        process.stdout.write(`OK   ${sku}\n`)
        logLines.push(`${sku},uploaded,${secureUrl}`)
      } catch (err) {
        failed++
        process.stdout.write(`FAIL ${sku}: ${err.message}\n`)
        logLines.push(`${sku},failed,"${(err.message || '').replace(/"/g, '""')}"`)
        continue
      }
    }

    const ids = skuToIds.get(sku.toUpperCase()) || []
    if (ids.length && secureUrl) {
      const { error } = await supabase
        .from('products')
        .update({ image_url: secureUrl, image_urls: [secureUrl] })
        .in('id', ids)
      if (error) {
        process.stdout.write(`  DB update failed for ${sku}: ${error.message}\n`)
      } else {
        dbUpdated += ids.length
      }
    }
  }

  await writeFileSafe(LOG_CSV, logLines.join('\n') + '\n')

  console.log(
    `\nDone. uploaded=${uploaded} skipped_existing=${skippedExisting} failed=${failed} missing_local_file=${missingLocalFile.size} products_updated=${dbUpdated}`
  )
  console.log(`Log written to ${LOG_CSV}`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
