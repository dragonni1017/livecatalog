// import-all-cloudinary-images-to-erply.mjs
// Run with: node scripts/import-all-cloudinary-images-to-erply.mjs
//
// Writes to Erply (not read-only). Generalizes
// backfill-cloudinary-images-to-erply.mjs (which only covered a static
// 168-SKU audit list, data/images/image-source-matrix.csv) to cover EVERY
// active Erply product whose SKU has a Supabase image_url (Cloudinary) and
// does NOT already have an image on Erply's CDN.
//
// "Already has an image" is checked against the CDN's own paginated
// GET https://cdn.erply.com/images listing (context "erply-product", not
// soft-deleted) -- the same source used by
// export-erply-cdn-images-inventory.mjs. Erply's getProducts `images` field
// is known to badly under-report (see docs/memory/project-erply-image-
// backfill.md, 2026-08-17: only 4/2871 products showed hasImage=true there
// even though 1,899 had actually been uploaded) so it is NOT used to decide
// what to skip.
//
// Uses the same CDN endpoint as the two earlier backfills (POST
// cdn.erply.com/images/urls, context "erply-product") -- Erply fetches the
// URL itself, no download/base64 needed. Chunked (8/request) with adaptive
// split-on-504, same as backfill-woo-images-to-erply.mjs and
// backfill-cloudinary-images-to-erply.mjs.
//
// Resumable: appends one row per SKU to
// data/images/cloudinary-erply-full-import-results.csv, skips any SKU
// already logged "uploaded" on a re-run.
//
// Run with: node scripts/import-all-cloudinary-images-to-erply.mjs
//           node scripts/import-all-cloudinary-images-to-erply.mjs --limit=20
//           node scripts/import-all-cloudinary-images-to-erply.mjs --dry-run
//
// Requires in .env.local:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD
//
// Meant to run locally, not in a sandbox: Erply's API domain isn't
// network-allowlisted there.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ERPLY_CLIENT_CODE = process.env.ERPLY_CLIENT_CODE
const ERPLY_USERNAME = process.env.ERPLY_USERNAME
const ERPLY_PASSWORD = process.env.ERPLY_PASSWORD

for (const [name, val] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_KEY, ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD })) {
  if (!val) { console.error(`Missing in .env.local: ${name}`); process.exit(1) }
}

const DRY_RUN = process.argv.includes('--dry-run')

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const RESULTS_PATH = path.join(ROOT, 'data', 'images', 'cloudinary-erply-full-import-results.csv')
const CHUNK_SIZE = 8 // same as the two earlier backfill scripts -- /images/urls fetches server-side, big batches risk a 504
const DELAY_MS = 150
const CDN_TIMEOUT_MS = 12000

const ERPLY_API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`
let sessionKey = null
let cdnJwt = null

async function erplyLogin() {
  const body = new URLSearchParams({ clientCode: ERPLY_CLIENT_CODE, request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  const res = await fetch(ERPLY_API_URL, { method: 'POST', body })
  const json = await res.json()
  if (json.status?.responseStatus === 'error') throw new Error(`Erply login error ${json.status.errorCode}`)
  sessionKey = json.records[0].sessionKey
  cdnJwt = json.records[0].token
}

async function erplyPost(params, { retryOnAuthError = true } = {}) {
  if (!sessionKey) await erplyLogin()
  const body = new URLSearchParams({ clientCode: ERPLY_CLIENT_CODE, sessionKey, ...params })
  const res = await fetch(ERPLY_API_URL, { method: 'POST', body })
  if (!res.ok) throw new Error(`Erply HTTP ${res.status}`)
  const json = await res.json()
  if (json.status?.responseStatus === 'error') {
    const code = json.status.errorCode
    if (retryOnAuthError && [1054, 1055, 1056].includes(code)) {
      sessionKey = null
      await erplyLogin()
      return erplyPost(params, { retryOnAuthError: false })
    }
    throw new Error(`Erply error ${code}: ${json.status.errorField ?? 'unknown'}`)
  }
  return json
}

async function fetchErplyActiveProductIds() {
  async function page(pageNo) {
    const data = await erplyPost({ request: 'getProducts', recordsOnPage: '300', pageNo: String(pageNo), active: '1' })
    return { products: data.records, total: data.status.recordsTotal ?? 0 }
  }
  const first = await page(1)
  const all = [...first.products]
  let pageNo = 2
  while (all.length < first.total) {
    const { products } = await page(pageNo)
    if (products.length === 0) break
    all.push(...products)
    pageNo++
  }
  return new Map(all.map((p) => [(p.code || String(p.productID)).trim().toUpperCase(), p.productID]))
}

// Ground truth for "does this product already have an Erply CDN image" --
// getProducts' own `images` field badly under-reports (see header note), so
// this reads the CDN's own paginated listing instead.
async function fetchCdnProductIdsWithImage() {
  if (!cdnJwt) await erplyLogin()
  const withImage = new Set()
  let pageNo = 1
  let total = Infinity
  let seen = 0
  while (seen < total) {
    const res = await fetch(`https://cdn.erply.com/images?page=${pageNo}`, { headers: { JWT: cdnJwt } })
    if (!res.ok) throw new Error(`Erply CDN HTTP ${res.status} on page ${pageNo}`)
    const data = await res.json()
    total = data.totalRecords
    for (const img of data.images) {
      if (img.isDeleted || img.context !== 'erply-product') continue
      withImage.add(img.productId)
    }
    seen += data.images.length
    if (data.images.length === 0) break
    pageNo++
  }
  return withImage
}

async function cdnUploadByUrls(items) {
  if (!cdnJwt) await erplyLogin()
  let res
  try {
    res = await fetch('https://cdn.erply.com/images/urls', {
      method: 'POST',
      headers: { JWT: cdnJwt, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: items }),
      signal: AbortSignal.timeout(CDN_TIMEOUT_MS),
    })
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      const timeoutErr = new Error(`client-side timeout after ${CDN_TIMEOUT_MS}ms (treated as gateway timeout)`)
      timeoutErr.httpStatus = 504
      throw timeoutErr
    }
    throw err
  }
  const text = await res.text()
  if (!res.ok) {
    const err = new Error(`CDN HTTP ${res.status}: ${text.slice(0, 300)}`)
    err.httpStatus = res.status
    throw err
  }
  return JSON.parse(text)
}

async function uploadChunkWithSplit(chunk) {
  const items = chunk.map((p) => ({
    context: 'erply-product',
    product_id: p.productID,
    sku: p.sku,
    url: p.imageUrl,
    filename: `${p.sku}.${extOf(p.imageUrl)}`,
  }))
  try {
    await cdnUploadByUrls(items)
    return chunk.map((p) => ({ sku: p.sku, imageUrl: p.imageUrl, status: 'uploaded', message: '' }))
  } catch (err) {
    const isGatewayTimeout = [502, 503, 504].includes(err.httpStatus)
    if (isGatewayTimeout && chunk.length > 1) {
      const mid = Math.ceil(chunk.length / 2)
      const left = await uploadChunkWithSplit(chunk.slice(0, mid))
      const right = await uploadChunkWithSplit(chunk.slice(mid))
      return [...left, ...right]
    }
    return chunk.map((p) => ({ sku: p.sku, imageUrl: p.imageUrl, status: 'error', message: err.message }))
  }
}

function extOf(url) {
  const m = /\.([a-z0-9]+)(?:\?|$)/i.exec(url)
  return m ? m[1] : 'jpg'
}

function loadDoneSkus() {
  if (!fs.existsSync(RESULTS_PATH)) return new Set()
  const lines = fs.readFileSync(RESULTS_PATH, 'utf8').trim().split('\n').slice(1)
  const done = new Set()
  const unquote = (s) => (s ?? '').replace(/^"|"$/g, '')
  for (const line of lines) {
    const [sku, , status] = line.split(',')
    if (unquote(status) === 'uploaded') done.add(unquote(sku))
  }
  return done
}

function appendResults(rows) {
  fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true })
  if (!fs.existsSync(RESULTS_PATH)) fs.writeFileSync(RESULTS_PATH, 'sku,imageUrl,status,message\n')
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = rows.map((r) => `${esc(r.sku)},${esc(r.imageUrl)},${esc(r.status)},${esc(r.message)}\n`)
  fs.appendFileSync(RESULTS_PATH, lines.join(''))
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchSupabaseImageUrls() {
  const bySku = new Map()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('products')
      .select('sku, image_url')
      .not('image_url', 'is', null)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`Supabase read error: ${error.message}`)
    for (const row of data) bySku.set(row.sku.trim().toUpperCase(), row.image_url)
    if (data.length < PAGE) break
  }
  return bySku
}

async function main() {
  console.log('Fetching Supabase image_url for all products...')
  const imageUrlBySku = await fetchSupabaseImageUrls()
  console.log(`  ${imageUrlBySku.size} SKUs have a Supabase image_url`)

  console.log('Fetching active Erply product IDs...')
  const productIdBySku = await fetchErplyActiveProductIds()
  console.log(`  ${productIdBySku.size} active Erply products`)

  console.log("Fetching Erply CDN's own image listing (ground truth for what's already there)...")
  const cdnProductIdsWithImage = await fetchCdnProductIdsWithImage()
  console.log(`  ${cdnProductIdsWithImage.size} products already have a live image on Erply's CDN`)

  if (process.argv.includes('--coverage')) {
    const activeIds = new Set(productIdBySku.values())
    const activeWithImage = [...activeIds].filter((id) => cdnProductIdsWithImage.has(id)).length
    console.log(`\nActive Erply products: ${activeIds.size}`)
    console.log(`  With a CDN image:    ${activeWithImage}`)
    console.log(`  Without a CDN image: ${activeIds.size - activeWithImage}`)
    const staleImages = [...cdnProductIdsWithImage].filter((id) => !activeIds.has(id)).length
    console.log(`(${staleImages} CDN images belong to inactive/non-matching product IDs, not counted above)`)
    return
  }

  const alreadyDone = loadDoneSkus()
  console.log(`  ${alreadyDone.size} SKUs already logged as uploaded by this script (resuming, will skip these)`)

  let todo = []
  let noErplyMatch = 0
  let alreadyOnCdn = 0
  const unmatchedSkus = []
  for (const [sku, imageUrl] of imageUrlBySku) {
    if (alreadyDone.has(sku)) continue
    const productID = productIdBySku.get(sku)
    if (!productID) { noErplyMatch++; unmatchedSkus.push(sku); continue }
    if (cdnProductIdsWithImage.has(productID)) { alreadyOnCdn++; continue }
    todo.push({ sku, productID, imageUrl })
  }
  console.log(`No matching active Erply SKU: ${noErplyMatch}`)
  console.log(`Already has an Erply CDN image (skipped): ${alreadyOnCdn}`)
  if (process.argv.includes('--show-unmatched')) {
    console.log('Unmatched SKUs (Cloudinary image, no active Erply product):')
    for (const sku of unmatchedSkus) console.log(`  ${sku}`)
  }

  const limitArg = process.argv.find((a) => a.startsWith('--limit='))
  if (limitArg) {
    const limit = Number(limitArg.split('=')[1])
    todo = todo.slice(0, limit)
    console.log(`--limit=${limit} passed -- only processing the first ${todo.length} SKUs this run.`)
  }

  console.log(`\n${todo.length} SKUs to push into Erply's CDN this run.\n`)

  if (DRY_RUN) {
    console.log('--dry-run passed -- not uploading. First 20 SKUs that would be pushed:')
    for (const p of todo.slice(0, 20)) console.log(`  ${p.sku} -> productID ${p.productID} -> ${p.imageUrl}`)
    return
  }

  let uploaded = 0
  let failed = 0
  for (let i = 0; i < todo.length; i += CHUNK_SIZE) {
    const chunk = todo.slice(i, i + CHUNK_SIZE)
    const results = await uploadChunkWithSplit(chunk)
    appendResults(results)
    uploaded += results.filter((r) => r.status === 'uploaded').length
    failed += results.filter((r) => r.status === 'error').length
    console.log(`  [${Math.min(i + CHUNK_SIZE, todo.length)}/${todo.length}] uploaded=${uploaded} failed=${failed}`)
    await sleep(DELAY_MS)
  }

  console.log(`\nDone. uploaded=${uploaded} failed=${failed}`)
  console.log(`Full log: data/images/cloudinary-erply-full-import-results.csv`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
