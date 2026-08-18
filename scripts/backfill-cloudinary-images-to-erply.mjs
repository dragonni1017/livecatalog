// backfill-cloudinary-images-to-erply.mjs
// Run with: node scripts/backfill-cloudinary-images-to-erply.mjs
//
// Writes to Erply (not read-only). Mirror of backfill-woo-images-to-erply.mjs
// (which pushed 1,899/1,899 Woo-sourced images into Erply's CDN on
// 2026-08-03, see docs/memory/project-erply-image-backfill.md) but for the
// remaining gap that backfill couldn't cover: SKUs that have a real picture
// in this repo's own Supabase (products.image_url, Cloudinary-hosted) but
// have NO image in WooCommerce at all -- so there was nothing on the Woo
// side for that earlier script to pull from.
//
// Confirmed live 2026-08-17 via scripts/find-truly-missing-images.mjs:
// 168 SKUs are cloudinaryHasImage=1, wooHasImage=0 (see
// data/images/image-source-matrix.csv). Uses the same Erply CDN endpoint
// (POST cdn.erply.com/images/urls, context "erply-product") that feeds
// Erply's own WooCommerce Integration sync -- same mechanism, just sourced
// from Supabase's image_url instead of Woo's image src.
//
// Erply's own getProducts `images` field under-reports badly (see the 2026-
// 08-17 memory update) so this does NOT use it to decide what's "already
// covered" -- it targets the audited 168-SKU gap directly. A handful of
// redundant re-uploads for SKUs that already secretly have an Erply image
// are harmless (adds another picture, doesn't overwrite/break anything).
//
// Resumable: appends one row per SKU to
// data/images/cloudinary-erply-backfill-results.csv, skips any SKU already
// logged "uploaded" on a re-run.
//
// Run with: node scripts/backfill-cloudinary-images-to-erply.mjs
//           node scripts/backfill-cloudinary-images-to-erply.mjs --limit=20
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

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const MATRIX_CSV = path.join(ROOT, 'data', 'images', 'image-source-matrix.csv')
const RESULTS_PATH = path.join(ROOT, 'data', 'images', 'cloudinary-erply-backfill-results.csv')
const CHUNK_SIZE = 8 // same as backfill-woo-images-to-erply.mjs -- /images/urls fetches server-side, big batches risk a 504
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

function parseGapSkusFromMatrix() {
  if (!fs.existsSync(MATRIX_CSV)) {
    console.error(`Missing ${path.relative(ROOT, MATRIX_CSV)} -- run scripts/find-truly-missing-images.mjs first.`)
    process.exit(1)
  }
  const lines = fs.readFileSync(MATRIX_CSV, 'utf8').trim().split('\n')
  const header = lines[0].split(',')
  const idx = Object.fromEntries(header.map((h, i) => [h, i]))
  const skus = []
  for (const line of lines.slice(1)) {
    const cols = line.split(',')
    if (cols[idx.cloudinaryHasImage] === '1' && cols[idx.wooHasImage] === '0') {
      skus.push(cols[idx.sku])
    }
  }
  return skus
}

async function main() {
  const gapSkus = parseGapSkusFromMatrix()
  console.log(`${gapSkus.length} SKUs from the audit matrix (Cloudinary has image, Woo does not).`)

  console.log('Fetching Supabase image_url for these SKUs...')
  const supaRows = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('products')
      .select('sku, image_url')
      .not('image_url', 'is', null)
      .range(from, from + PAGE - 1)
    if (error) { console.error('Supabase read error:', error.message); process.exit(1) }
    supaRows.push(...data)
    if (data.length < PAGE) break
  }
  const imageUrlBySku = new Map(supaRows.map((r) => [r.sku.trim().toUpperCase(), r.image_url]))

  console.log('Fetching active Erply product IDs...')
  const productIdBySku = await fetchErplyActiveProductIds()
  console.log(`  ${productIdBySku.size} active Erply products`)

  const alreadyDone = loadDoneSkus()
  console.log(`  ${alreadyDone.size} SKUs already logged as uploaded (resuming, will skip these)`)

  let todo = []
  let noErplyMatch = 0
  let noImageUrl = 0
  for (const sku of gapSkus) {
    if (alreadyDone.has(sku)) continue
    const productID = productIdBySku.get(sku.toUpperCase())
    const imageUrl = imageUrlBySku.get(sku.toUpperCase())
    if (!productID) { noErplyMatch++; continue }
    if (!imageUrl) { noImageUrl++; continue }
    todo.push({ sku, productID, imageUrl })
  }
  console.log(`No matching active Erply SKU: ${noErplyMatch}`)
  console.log(`No Supabase image_url (unexpected): ${noImageUrl}`)

  const limitArg = process.argv.find((a) => a.startsWith('--limit='))
  if (limitArg) {
    const limit = Number(limitArg.split('=')[1])
    todo = todo.slice(0, limit)
    console.log(`--limit=${limit} passed -- only processing the first ${todo.length} SKUs this run.`)
  }

  console.log(`\n${todo.length} SKUs to push into Erply's CDN this run.\n`)

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
  console.log(`Full log: data/images/cloudinary-erply-backfill-results.csv`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
