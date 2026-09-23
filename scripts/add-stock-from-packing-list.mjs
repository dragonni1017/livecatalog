// add-stock-from-packing-list.mjs
// Run with: node scripts/add-stock-from-packing-list.mjs --file="<path to supplier xls/xlsx>"          (dry run)
//           node scripts/add-stock-from-packing-list.mjs --file="<path>" --apply
//
// Companion to import-packing-list.mjs (which writes carton dimensions to
// Supabase). This script instead registers the shipment's received
// quantity as new stock IN ERPLY, for whichever SKUs on the sheet already
// exist there. It follows the exact same pattern as the older, hardcoded
// add-stock-from-arrival-lists.mjs -- generalised to take --file= instead
// of a fixed list, and to find its SKU/quantity columns by header text
// (matching import-packing-list.mjs's approach) since sheet layout varies
// by supplier.
//
// WHY ERPLY AND NOT SUPABASE: Erply has no "set absolute stock" call, only
// deltas (saveInventoryRegistration to add, saveInventoryWriteOff to
// remove) -- a real arrival is always an addition, so only
// saveInventoryRegistration is used. Supabase's own products.stock_qty is
// deliberately NOT overwritten by the normal Erply sync (it gets
// decremented on order fulfillment -- see app/api/sync/route.ts's
// skipFields), so writing it directly here would fight that and get
// clobbered by the next sync anyway. Erply is the system of record for
// stock; Supabase picks it up from there.
//
// MATCHING IS EXACT SKU (货号/code) ONLY -- no barcode fallback. Mirrors
// add-stock-from-arrival-lists.mjs's own deliberate choice: two SKUs in an
// earlier batch matched an existing Erply product only by barcode, not
// code, and were excluded pending confirmation those were really the same
// product. A SKU with no exact Erply match is reported, not written --
// that covers both genuinely-new products (need saveProduct with an
// English name + category first, neither of which a packing list has) and
// any barcode-only near-match, which needs a human look either way.
//
// Quantity is the sheet's QTY column (total pieces for that line -- pack
// size x carton count, already totalled by the supplier, same semantics as
// add-stock-from-arrival-lists.mjs's 总PCS), summed per SKU if it appears
// on more than one line in the file.
//
// Safety, matching this repo's established pattern for bulk Erply writes:
// - Dry run by default, --apply required to write.
// - Backup CSV of planned changes written BEFORE any writes.
// - Batched (50 rows/request), warehouse 1 ("L&Y USA").
// - After --apply, independently re-fetches live stock to confirm.
//
// Requires in .env.local: ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createRequire } from 'module'
import { assertStockWriteAllowed } from './stock-write-guard.mjs'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })

const APPLY = process.argv.includes('--apply')
const fileArg = process.argv.find((a) => a.startsWith('--file='))?.slice('--file='.length)
if (!fileArg) {
  console.error('Usage: node scripts/add-stock-from-packing-list.mjs --file="<path to xls/xlsx>" [--apply]')
  process.exit(1)
}
const INPUT = path.resolve(fileArg)
if (!fs.existsSync(INPUT)) {
  console.error(`No such file: ${INPUT}`)
  process.exit(1)
}

const WAREHOUSE_ID = 1 // "L&Y USA" -- confirmed via getWarehouses, see docs/memory/project-erply-pagination-fix.md
const CHUNK_SIZE = 50

const { ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD } = process.env
for (const [name, val] of Object.entries({ ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD })) {
  if (!val) { console.error(`Missing in .env.local: ${name}`); process.exit(1) }
}
const ERPLY_API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`

const OUT_DIR = path.join(ROOT, 'data', 'erply-bulk-import')
const OUT_CSV = path.join(OUT_DIR, `packing-list-stock-${path.basename(INPUT).replace(/[^\w.-]+/g, '_')}.csv`)

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

// Same header-text matching as import-packing-list.mjs, not fixed position.
function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i] ?? []
    if (row.some((cell) => typeof cell === 'string' && cell.includes('货号'))) return i
  }
  return -1
}

function findCol(headerRow, substrings) {
  for (let i = 0; i < headerRow.length; i++) {
    const cell = headerRow[i]
    if (typeof cell !== 'string') continue
    if (substrings.every((s) => cell.toUpperCase().includes(s.toUpperCase()))) return i
  }
  return -1
}

function parsePackingList() {
  const wb = XLSX.readFile(INPUT)
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null })
    const headerRowIndex = findHeaderRow(rows)
    if (headerRowIndex < 0) continue

    const headerRow = rows[headerRowIndex]
    const skuCol = findCol(headerRow, ['货号'])
    // 'QTY' alone, not '总量KG' or '总体积' -- those also start with 总 but
    // this file's QTY column is literally headed "QTY" in English.
    const qtyCol = findCol(headerRow, ['QTY'])
    if (skuCol < 0 || qtyCol < 0) {
      console.error(`Found a 货号 header but no matching QTY column in sheet "${name}": ${JSON.stringify(headerRow)}`)
      process.exit(1)
    }

    const out = []
    for (const row of rows.slice(headerRowIndex + 1)) {
      if (!row || !row[skuCol]) continue
      const sku = String(row[skuCol]).trim()
      const qty = Number(row[qtyCol]) || 0
      out.push({ sku, qty })
    }
    return out
  }
  console.error('No sheet with a 货号 column found -- this file may not be a packing list this script understands.')
  process.exit(1)
}

async function fetchAllErplyProducts(sessionKey) {
  const bySku = new Map()
  let pageNo = 1, total = Infinity, fetched = 0
  while (fetched < total) {
    const data = await erplyPost({
      request: 'getProducts', sessionKey, recordsOnPage: '500', pageNo: String(pageNo), getStockInfo: '1',
    })
    total = data.status.recordsTotal ?? 0
    for (const p of data.records) {
      const code = (p.code || '').trim().toUpperCase()
      if (!code) continue
      const stockAtWarehouse = Number(p.warehouses?.[String(WAREHOUSE_ID)]?.totalInStock ?? 0)
      bySku.set(code, { productID: p.productID, name: p.name, code: p.code, stockAtWarehouse })
    }
    fetched += data.records.length
    if (data.records.length === 0) break
    pageNo++
  }
  return bySku
}

function toCsv(rows) {
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const header = 'productID,sku,name,warehouseID,oldStock,addQty,newStock'
  const lines = rows.map((r) =>
    [r.productID, r.sku, esc(r.name), WAREHOUSE_ID, r.oldStock, r.addQty, r.oldStock + r.addQty].join(','))
  return [header, ...lines].join('\n') + '\n'
}

async function saveInventoryRegistrationBatch(sessionKey, chunk) {
  const params = { request: 'saveInventoryRegistration', sessionKey, warehouseID: String(WAREHOUSE_ID) }
  chunk.forEach((c, i) => {
    params[`productID${i + 1}`] = String(c.productID)
    params[`amount${i + 1}`] = String(c.addQty)
  })
  return erplyPost(params)
}

async function main() {
  if (APPLY) assertStockWriteAllowed('add-stock-from-packing-list.mjs', { what: 'This script adds container stock to Erply from a packing list' })
  console.log(`${APPLY ? '' : '[DRY RUN] '}Reading ${INPUT}...`)
  const rows = parsePackingList()

  const bySku = new Map()
  for (const r of rows) {
    if (!r.sku) continue
    const key = r.sku.toUpperCase()
    if (!bySku.has(key)) bySku.set(key, { sku: r.sku, totalQty: 0 })
    bySku.get(key).totalQty += r.qty
  }
  console.log(`  ${rows.length} line items, ${bySku.size} distinct SKUs`)

  console.log('\nAuthenticating with Erply...')
  const auth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  const sessionKey = auth.records[0].sessionKey

  console.log(`Fetching all Erply products with stock (warehouse ${WAREHOUSE_ID})...`)
  const erplyBySku = await fetchAllErplyProducts(sessionKey)
  console.log(`  ${erplyBySku.size} Erply products loaded`)

  const changes = []
  const noMatch = []
  for (const [key, entry] of bySku) {
    const erply = erplyBySku.get(key)
    if (!erply) { noMatch.push(entry.sku); continue }
    if (entry.totalQty <= 0) continue
    changes.push({
      productID: erply.productID,
      sku: entry.sku,
      name: erply.name,
      oldStock: erply.stockAtWarehouse,
      addQty: entry.totalQty,
    })
  }

  console.log(`\n=== Summary ===`)
  console.log(`Exact SKU matches in Erply: ${changes.length}`)
  console.log(`No exact SKU match in Erply (new product or barcode-only match -- needs a human look, not written): ${noMatch.length}`)
  if (noMatch.length > 0) console.log(`  ${noMatch.join(', ')}`)

  console.log('\nPlanned changes:')
  for (const c of changes) {
    console.log(`  ${c.sku} (${(c.name || '').slice(0, 45)}): ${c.oldStock} -> ${c.oldStock + c.addQty} (+${c.addQty})`)
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(OUT_CSV, toCsv(changes))
  console.log(`\nPlanned changes written to ${path.relative(ROOT, OUT_CSV)}`)

  if (!APPLY) {
    console.log(`\nDry run only -- zero writes made. Re-run with --apply to write ${changes.length} stock additions to Erply.`)
    return
  }

  console.log(`\n--apply set. Registering +stock for ${changes.length} products in warehouse ${WAREHOUSE_ID}, batches of ${CHUNK_SIZE}...`)
  let ok = 0, failed = 0
  for (let i = 0; i < changes.length; i += CHUNK_SIZE) {
    const chunk = changes.slice(i, i + CHUNK_SIZE)
    try {
      await saveInventoryRegistrationBatch(sessionKey, chunk)
      ok += chunk.length
      console.log(`  batch ${i / CHUNK_SIZE + 1}: ${chunk.length} products registered`)
    } catch (err) {
      failed += chunk.length
      console.error(`  batch ${i / CHUNK_SIZE + 1} FAILED: ${err.message}`)
    }
  }
  console.log(`\nDone. ${ok} succeeded, ${failed} failed.`)

  console.log('\nIndependently re-fetching live stock to confirm...')
  const verifyBySku = await fetchAllErplyProducts(sessionKey)
  let confirmed = 0, mismatched = 0
  for (const c of changes) {
    const now = verifyBySku.get(c.sku.toUpperCase())
    const expected = c.oldStock + c.addQty
    if (now?.stockAtWarehouse === expected) {
      confirmed++
    } else {
      mismatched++
      console.log(`  MISMATCH ${c.sku}: expected ${expected}, got ${now?.stockAtWarehouse}`)
    }
  }
  console.log(`\nVerified: ${confirmed} confirmed, ${mismatched} mismatched.`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
