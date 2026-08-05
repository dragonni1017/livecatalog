// backfill-woo-images-to-erply.mjs
// Run with: node scripts/backfill-woo-images-to-erply.mjs
//
// Writes to Erply (not read-only, unlike the other erply-woo scripts).
// For every active Erply product that has no image but has a matching
// WooCommerce product (by SKU) that DOES have an image, tells Erply's CDN
// API to fetch that Woo image URL directly and attach it to the product
// with context "erply-product" -- the tag Erply's CDN API docs say is
// required for something to count as a real product picture (and the one
// their WooCommerce integration reads, per wiki.erply.com/fi/article/1265).
// No download/convert/base64 step needed: Erply's CDN fetches the URL
// itself. See docs/memory/project-erply-image-backfill.md for the full
// investigation (why this endpoint over saveProductPicture, confirmed
// working live 2026-08-03 on SKU IC44200 / productID 2847).
//
// This is the reverse of the old Erply -> Cloudinary backfill
// (download-erply-images.mjs / upload-images-to-cloudinary.mjs): those pull
// FROM Erply. This one pushes Woo's already-uploaded images INTO Erply.
//
// Resumable: appends one row per SKU to data/erply-woo-review/erply-image-
// backfill-results.csv as it goes, and skips any SKU already logged as
// "uploaded" on a re-run -- safe to Ctrl-C and restart.
//
// Requires the same .env.local vars as compare-erply-woo.mjs:
//   ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD
//   WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const ERPLY_CLIENT_CODE = process.env.ERPLY_CLIENT_CODE
const ERPLY_USERNAME = process.env.ERPLY_USERNAME
const ERPLY_PASSWORD = process.env.ERPLY_PASSWORD
const WOO_STORE_URL_RAW = process.env.WOO_STORE_URL
const WOO_STORE_URL = WOO_STORE_URL_RAW
  ? (/^https?:\/\//i.test(WOO_STORE_URL_RAW) ? WOO_STORE_URL_RAW : `https://${WOO_STORE_URL_RAW}`).replace(/\/+$/, '')
  : WOO_STORE_URL_RAW
const WOO_CONSUMER_KEY = process.env.WOO_CONSUMER_KEY
const WOO_CONSUMER_SECRET = process.env.WOO_CONSUMER_SECRET

for (const [name, val] of Object.entries({ ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD, WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET })) {
  if (!val) { console.error(`Missing in .env.local: ${name}`); process.exit(1) }
}

const RESULTS_PATH = path.join(ROOT, 'data', 'erply-woo-review', 'erply-image-backfill-results.csv')
const CACHE_PATH = path.join(ROOT, 'data', 'erply-woo-review', 'backfill-todo-cache.json')
// /images/urls fetches every image server-side before responding, so a big
// batch risks a CloudFront 504 (confirmed live 2026-08-03: a 25-item chunk
// timed out at 504, a 1-item chunk succeeded in ~1-2s). Rather than guess a
// magic safe size, start at CHUNK_SIZE and adaptively halve on timeout --
// see uploadChunkWithSplit.
const CHUNK_SIZE = 8
const DELAY_MS = 150 // spacing between CDN API batches
const CDN_TIMEOUT_MS = 12000 // fail fast and split rather than wait out CloudFront's own ~30s 504

// ── Erply classic API (for product list + login) ────────────────────────────

const ERPLY_API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`
let sessionKey = null
let cdnJwt = null

async function erplyLogin() {
  const body = new URLSearchParams({ clientCode: ERPLY_CLIENT_CODE, request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  const res = await fetch(ERPLY_API_URL, { method: 'POST', body })
  const json = await res.json()
  if (json.status?.responseStatus === 'error') throw new Error(`Erply login error ${json.status.errorCode}`)
  sessionKey = json.records[0].sessionKey
  cdnJwt = json.records[0].token // JWT with CDN/manage-resources scope -- passed straight to cdn.erply.com as header "JWT"
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

async function fetchErplyActiveProducts() {
  async function page(pageNo) {
    const data = await erplyPost({ request: 'getProducts', recordsOnPage: '300', pageNo: String(pageNo), getImages: '1', active: '1' })
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
  return all.map((p) => ({
    sku: (p.code || String(p.productID)).trim(),
    productID: p.productID,
    hasImage: Array.isArray(p.images) && p.images.length > 0,
  }))
}

// ── Erply CDN API (the write that actually reaches the Woo integration) ────

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

// Adaptively halves the batch on a gateway timeout (502/503/504) instead of
// trusting one fixed chunk size -- a 25-item batch 504'd in testing, a
// 1-item batch never has. Real validation errors (4xx other than a gateway
// timeout) won't be fixed by splitting, so those still fail the whole
// (sub-)chunk immediately rather than retrying uselessly down to size 1.
async function uploadChunkWithSplit(chunk) {
  const items = chunk.map((p) => ({
    context: 'erply-product',
    product_id: p.productID,
    sku: p.sku,
    url: p.wooImageSrc,
    filename: `${p.sku}.${extOf(p.wooImageSrc)}`,
  }))
  try {
    await cdnUploadByUrls(items)
    return chunk.map((p) => ({ sku: p.sku, wooImageSrc: p.wooImageSrc, status: 'uploaded', message: '' }))
  } catch (err) {
    const isGatewayTimeout = [502, 503, 504].includes(err.httpStatus)
    if (isGatewayTimeout && chunk.length > 1) {
      const mid = Math.ceil(chunk.length / 2)
      const left = await uploadChunkWithSplit(chunk.slice(0, mid))
      const right = await uploadChunkWithSplit(chunk.slice(mid))
      return [...left, ...right]
    }
    return chunk.map((p) => ({ sku: p.sku, wooImageSrc: p.wooImageSrc, status: 'error', message: err.message }))
  }
}

// ── WooCommerce ──────────────────────────────────────────────────────────────

function wooAuthHeader() {
  return `Basic ${Buffer.from(`${WOO_CONSUMER_KEY}:${WOO_CONSUMER_SECRET}`).toString('base64')}`
}

async function fetchWooImagesBySku() {
  const perPage = 100
  let pageNo = 1
  const bySku = new Map()
  while (true) {
    const url = `${WOO_STORE_URL}/wp-json/wc/v3/products?per_page=${perPage}&page=${pageNo}&status=any`
    const res = await fetch(url, { headers: { Authorization: wooAuthHeader() } })
    if (!res.ok) throw new Error(`WooCommerce HTTP ${res.status} on page ${pageNo}`)
    const batch = await res.json()
    if (!Array.isArray(batch) || batch.length === 0) break
    for (const p of batch) {
      const sku = (p.sku ?? '').trim()
      if (sku && Array.isArray(p.images) && p.images.length > 0) {
        bySku.set(sku, p.images[0].src)
      }
    }
    if (batch.length < perPage) break
    pageNo++
  }
  return bySku
}

// ── CSV results log (resumable) ─────────────────────────────────────────────

function loadDoneSkus() {
  if (!fs.existsSync(RESULTS_PATH)) return new Set()
  const lines = fs.readFileSync(RESULTS_PATH, 'utf8').trim().split('\n').slice(1)
  const done = new Set()
  const unquote = (s) => (s ?? '').replace(/^"|"$/g, '')
  for (const line of lines) {
    const [sku, , status] = line.split(',')
    // BUG (fixed 2026-08-03): fields are written quoted (appendResults'
    // `esc()`), so status arrives as the literal string '"uploaded"' --
    // comparing against 'uploaded' unquoted never matched, silently
    // disabling resume entirely (every run re-uploaded the same early SKUs
    // instead of skipping them). Unquote both sides before comparing.
    if (unquote(status) === 'uploaded') done.add(unquote(sku))
  }
  return done
}

function appendResults(rows) {
  fs.mkdirSync(path.dirname(RESULTS_PATH), { recursive: true })
  if (!fs.existsSync(RESULTS_PATH)) fs.writeFileSync(RESULTS_PATH, 'sku,wooImageSrc,status,message\n')
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const lines = rows.map((r) => `${esc(r.sku)},${esc(r.wooImageSrc)},${esc(r.status)},${esc(r.message)}\n`)
  fs.appendFileSync(RESULTS_PATH, lines.join(''))
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function extOf(url) {
  const m = /\.([a-z0-9]+)(?:\?|$)/i.exec(url)
  return m ? m[1] : 'jpg'
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // The Erply (2,870 products, paginated) + Woo (3,042 products, paginated)
  // fetch alone takes most of a 45s budget, which this sandbox's bash tool
  // enforces per call -- and background/nohup processes get killed the
  // instant the spawning call ends (confirmed empirically 2026-08-03: a
  // `nohup ... & disown`'d run produced zero output, even after a 30s wait
  // in a follow-up call). So: fetch once, cache the resulting todo list to
  // disk, and every subsequent invocation loads the cache instead of
  // re-fetching -- turning this from "one 45s-capped call per handful of
  // SKUs" into "one slow call, then many fast ones." Pass --refresh to force
  // a re-fetch (e.g. if Woo/Erply data changed since the cache was written).
  const forceRefresh = process.argv.includes('--refresh')
  let todoFull

  if (!forceRefresh && fs.existsSync(CACHE_PATH)) {
    console.log('Loading cached product/image lists (skip fetch; pass --refresh to redo it)...')
    todoFull = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'))
    console.log(`  ${todoFull.length} SKUs in cache`)
  } else {
    console.log('Fetching active Erply products (with image status)...')
    const erplyProducts = await fetchErplyActiveProducts()
    console.log(`  ${erplyProducts.length} active Erply products`)

    console.log('Fetching WooCommerce images by SKU...')
    const wooImages = await fetchWooImagesBySku()
    console.log(`  ${wooImages.size} Woo products have at least one image`)

    todoFull = erplyProducts
      .filter((p) => !p.hasImage && wooImages.has(p.sku))
      .map((p) => ({ sku: p.sku, productID: p.productID, wooImageSrc: wooImages.get(p.sku) }))

    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true })
    fs.writeFileSync(CACHE_PATH, JSON.stringify(todoFull, null, 2))
    console.log(`  Cached ${todoFull.length}-SKU todo list to ${path.relative(ROOT, CACHE_PATH)}`)
  }

  const alreadyDone = loadDoneSkus()
  console.log(`  ${alreadyDone.size} SKUs already logged as uploaded (resuming, will skip these)`)

  let todo = todoFull.filter((p) => !alreadyDone.has(p.sku))

  const limitArg = process.argv.find((a) => a.startsWith('--limit='))
  if (limitArg) {
    const limit = Number(limitArg.split('=')[1])
    todo = todo.slice(0, limit)
    console.log(`--limit=${limit} passed -- only processing the first ${todo.length} SKUs this run.`)
  }

  console.log(`\n${todo.length} SKUs left to backfill (of ${todoFull.length} total).\n`)

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
  console.log(`Full log: data/erply-woo-review/erply-image-backfill-results.csv`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
