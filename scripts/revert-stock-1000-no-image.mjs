// revert-stock-1000-no-image.mjs
// Run with: node scripts/revert-stock-1000-no-image.mjs           (dry run)
//           node scripts/revert-stock-1000-no-image.mjs --apply    (writes)
//
// Reverts the stock-1000 connectivity test (see
// docs/memory/project-erply-pagination-fix.md) for the subset of those SKUs
// that still show no working image in WooCommerce (confirmed 2026-08-17:
// Erply's "Products sync" does not push images to Woo at all, regardless of
// source or how long it's had -- see
// docs/memory/project-erply-image-backfill.md). A product showing
// "in stock" with no picture is a worse listing than one correctly marked
// out of stock, so Dragon asked to put these back to a real out-of-stock
// state in BOTH Erply and WooCommerce, now that the connectivity test is
// done with.
//
// Scope: the 2,074-SKU stock-1000 test list
// (data/erply-stock-1000-test/planned-changes.csv), filtered live to just
// the ones with NO working image in Woo right now. Confirmed 2026-08-17:
// 171 SKUs, all manage_stock=true, all status=publish.
//
// Writes to BOTH systems:
// - Erply: saveInventoryWriteOff (warehouse 1 "L&Y USA", reasonID 4
//   "warehouse leftovers" -- Dragon's choice from the account's only 4
//   configured reason codes, see chat 2026-08-17) for the product's current
//   live stock amount, bringing it back to 0. Erply has no "set absolute
//   stock" call, only deltas -- this is the writeOff counterpart to the
//   original saveInventoryRegistration write.
// - WooCommerce: batch update stock_status=outofstock AND
//   stock_quantity=0. Both fields are required -- confirmed 2026-08-17
//   (see docs/memory/project-woo-direct-outofstock-write.md) that
//   WooCommerce silently reverts a stock_status-only write back to instock
//   for manage_stock=true products based on quantity, so quantity must be
//   zeroed too or the status change won't stick.
//
// Safety, matching this repo's established pattern for bulk writes:
// - Dry run by default, --apply required to write.
// - Writes a backup CSV (sku, wooId, erplyProductID, oldErplyStock,
//   oldWooStockQty) to data/revert-stock-1000-no-image/planned-changes.csv
//   BEFORE any writes.
// - Batches: Erply writeOff 50 rows/doc, Woo batch update 100/call.
// - After --apply, re-fetches both systems independently to verify --
//   never trusts either write API's own success response alone (see the
//   verify surprises from both the original stock write and the
//   direct-Woo out-of-stock write earlier this session).
//
// Requires in .env.local:
//   ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD
//   WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET
//
// Meant to run locally, not in a sandbox: Erply's API domain isn't
// network-allowlisted there.

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

const WAREHOUSE_ID = 1 // "L&Y USA"
const REASON_ID = 4 // "warehouse leftovers"
const ERPLY_CHUNK = 50
const WOO_CHUNK = 100

const ERPLY_API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`
async function erplyPost(params) {
  const body = new URLSearchParams({ clientCode: ERPLY_CLIENT_CODE, ...params })
  const res = await fetch(ERPLY_API_URL, { method: 'POST', body })
  if (!res.ok) throw new Error(`Erply HTTP ${res.status}`)
  const json = await res.json()
  if (json.status?.responseStatus === 'error') {
    throw new Error(`Erply error ${json.status.errorCode}: ${json.status.errorField ?? 'unknown'}`)
  }
  return json
}

function wooAuthHeader() {
  return `Basic ${Buffer.from(`${WOO_CONSUMER_KEY}:${WOO_CONSUMER_SECRET}`).toString('base64')}`
}

async function fetchAllWooProducts() {
  const perPage = 100
  let pageNo = 1
  const all = []
  while (true) {
    const url = `${WOO_STORE_URL}/wp-json/wc/v3/products?per_page=${perPage}&page=${pageNo}&status=any`
    const res = await fetch(url, { headers: { Authorization: wooAuthHeader() } })
    if (!res.ok) throw new Error(`WooCommerce HTTP ${res.status} on page ${pageNo}`)
    const batch = await res.json()
    if (!Array.isArray(batch) || batch.length === 0) break
    all.push(...batch)
    if (batch.length < perPage) break
    pageNo++
  }
  return all
}

async function fetchErplyStockBySku(sessionKey) {
  async function page(pageNo) {
    const data = await erplyPost({
      request: 'getProducts', sessionKey, recordsOnPage: '300', pageNo: String(pageNo),
      getStockInfo: '1', active: '1',
    })
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
  const bySku = new Map()
  for (const p of all) {
    const sku = (p.code || String(p.productID)).trim().toUpperCase()
    const stock = Number(p.warehouses?.[String(WAREHOUSE_ID)]?.totalInStock ?? 0)
    bySku.set(sku, { productID: p.productID, stock })
  }
  return bySku
}

function toCsv(rows) {
  const esc = (v) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = 'sku,wooId,erplyProductID,oldErplyStock,oldWooStockQty'
  const lines = rows.map((r) => [esc(r.sku), r.wooId, r.erplyProductID, r.oldErplyStock, r.oldWooStockQty].join(','))
  return [header, ...lines].join('\n') + '\n'
}

async function main() {
  const apply = process.argv.includes('--apply')

  const testCsv = fs.readFileSync(path.join(ROOT, 'data', 'erply-stock-1000-test', 'planned-changes.csv'), 'utf8')
  const testSkus = testCsv.trim().split('\n').slice(1).map((l) => l.split(',')[1])
  console.log(`${testSkus.length} SKUs in the original stock-1000 test`)

  console.log('Fetching live WooCommerce catalog...')
  const wooAll = await fetchAllWooProducts()
  const wooBySku = new Map(wooAll.filter((p) => p.sku).map((p) => [p.sku.trim(), p]))

  console.log('Authenticating with Erply and fetching live stock...')
  const auth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  const sessionKey = auth.records[0].sessionKey
  const erplyBySku = await fetchErplyStockBySku(sessionKey)

  const changes = []
  let hasWorkingImage = 0
  let noWooMatch = 0
  let noErplyMatch = 0
  let alreadyZero = 0
  for (const sku of testSkus) {
    const w = wooBySku.get(sku)
    if (!w) { noWooMatch++; continue }
    const workingImage = Array.isArray(w.images) && w.images.length > 0
    if (workingImage) { hasWorkingImage++; continue }
    const e = erplyBySku.get(sku.toUpperCase())
    if (!e) { noErplyMatch++; continue }
    if (e.stock === 0 && Number(w.stock_quantity) === 0 && w.stock_status === 'outofstock') { alreadyZero++; continue }
    changes.push({
      sku,
      wooId: w.id,
      erplyProductID: e.productID,
      oldErplyStock: e.stock,
      oldWooStockQty: w.stock_quantity,
    })
  }

  console.log(`\n=== Dry run summary ===`)
  console.log(`Has a working image in Woo (left alone): ${hasWorkingImage}`)
  console.log(`No Woo match:                             ${noWooMatch}`)
  console.log(`No Erply match:                           ${noErplyMatch}`)
  console.log(`Already reverted (both 0/outofstock):     ${alreadyZero}`)
  console.log(`To revert:                                ${changes.length}`)
  if (changes.length) {
    console.log('\nSample (first 10):')
    for (const c of changes.slice(0, 10)) {
      console.log(`  ${c.sku} | erply ${c.oldErplyStock} -> 0 | woo qty ${c.oldWooStockQty} -> 0/outofstock`)
    }
  }

  if (!apply) {
    console.log(`\nDry run only -- zero writes made. Re-run with --apply to revert ${changes.length} products in both Erply and WooCommerce.`)
    return
  }

  if (changes.length === 0) {
    console.log('\nNothing to apply. Done.')
    return
  }

  const outDir = path.join(ROOT, 'data', 'revert-stock-1000-no-image')
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'planned-changes.csv'), toCsv(changes))
  console.log(`\nBackup written to data/revert-stock-1000-no-image/planned-changes.csv before any writes.`)

  console.log(`\n--apply set. Writing off Erply stock (warehouse ${WAREHOUSE_ID}, reason "warehouse leftovers")...`)
  let erplyOk = 0, erplyFailed = 0
  const erplyFailedSkus = []
  for (let i = 0; i < changes.length; i += ERPLY_CHUNK) {
    const chunk = changes.slice(i, i + ERPLY_CHUNK)
    const params = { request: 'saveInventoryWriteOff', sessionKey, warehouseID: String(WAREHOUSE_ID), reasonID: String(REASON_ID) }
    chunk.forEach((c, idx) => {
      params[`productID${idx + 1}`] = String(c.erplyProductID)
      params[`amount${idx + 1}`] = String(c.oldErplyStock)
    })
    try {
      await erplyPost(params)
      erplyOk += chunk.length
      console.log(`  Erply batch ${Math.floor(i / ERPLY_CHUNK) + 1}: ${chunk.length} written off`)
    } catch (err) {
      erplyFailed += chunk.length
      chunk.forEach((c) => erplyFailedSkus.push(`${c.sku}: ${err.message}`))
      console.error(`  Erply batch ${Math.floor(i / ERPLY_CHUNK) + 1} FAILED: ${err.message}`)
    }
  }
  console.log(`Erply done: ${erplyOk} written off, ${erplyFailed} failed.`)
  if (erplyFailedSkus.length) console.log('Erply failures:\n  ' + erplyFailedSkus.join('\n  '))

  console.log(`\nUpdating WooCommerce (stock_status=outofstock, stock_quantity=0)...`)
  let wooOk = 0, wooFailed = 0
  const wooFailedSkus = []
  for (let i = 0; i < changes.length; i += WOO_CHUNK) {
    const chunk = changes.slice(i, i + WOO_CHUNK)
    const body = { update: chunk.map((c) => ({ id: c.wooId, stock_status: 'outofstock', stock_quantity: 0 })) }
    try {
      const res = await fetch(`${WOO_STORE_URL}/wp-json/wc/v3/products/batch`, {
        method: 'POST',
        headers: { Authorization: wooAuthHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const text = await res.text()
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
      const result = JSON.parse(text)
      const updated = result.update ?? []
      const succeeded = updated.filter((u) => !u.error).length
      const chunkFailed = updated.filter((u) => u.error)
      wooOk += succeeded
      wooFailed += chunkFailed.length
      chunkFailed.forEach((u) => wooFailedSkus.push(`id=${u.id}: ${u.error?.message ?? 'unknown'}`))
      console.log(`  Woo batch ${Math.floor(i / WOO_CHUNK) + 1}: ${succeeded}/${chunk.length} updated`)
    } catch (err) {
      wooFailed += chunk.length
      chunk.forEach((c) => wooFailedSkus.push(`${c.sku}: ${err.message}`))
      console.error(`  Woo batch ${Math.floor(i / WOO_CHUNK) + 1} FAILED: ${err.message}`)
    }
  }
  console.log(`Woo done: ${wooOk} updated, ${wooFailed} failed.`)
  if (wooFailedSkus.length) console.log('Woo failures:\n  ' + wooFailedSkus.join('\n  '))

  console.log('\nRe-fetching both systems to independently verify...')
  const reAuth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  const reErplyBySku = await fetchErplyStockBySku(reAuth.records[0].sessionKey)
  const reWooAll = await fetchAllWooProducts()
  const reWooById = new Map(reWooAll.map((p) => [p.id, p]))

  let erplyVerified = 0, erplyMismatch = 0
  let wooVerified = 0, wooMismatch = 0
  const mismatchSamples = []
  for (const c of changes) {
    const eNow = reErplyBySku.get(c.sku.toUpperCase())
    const wNow = reWooById.get(c.wooId)
    const erplyOkNow = eNow && eNow.stock === 0
    const wooOkNow = wNow && Number(wNow.stock_quantity) === 0 && wNow.stock_status === 'outofstock'
    if (erplyOkNow) erplyVerified++; else erplyMismatch++
    if (wooOkNow) wooVerified++; else wooMismatch++
    if ((!erplyOkNow || !wooOkNow) && mismatchSamples.length < 10) {
      mismatchSamples.push(`  ${c.sku}: erply stock=${eNow?.stock ?? 'MISSING'}, woo qty=${wNow?.stock_quantity ?? 'MISSING'} status=${wNow?.stock_status ?? 'MISSING'}`)
    }
  }
  console.log(`Erply verified 0: ${erplyVerified}/${changes.length} (mismatched: ${erplyMismatch})`)
  console.log(`Woo verified outofstock/0: ${wooVerified}/${changes.length} (mismatched: ${wooMismatch})`)
  if (mismatchSamples.length) console.log('Mismatches:\n' + mismatchSamples.join('\n'))
}

main().catch((err) => {
  console.error('Fatal error:', err.message)
  process.exitCode = 1
})
