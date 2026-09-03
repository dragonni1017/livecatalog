// add-stock-from-arrival-lists.mjs
// Run with: node scripts/add-stock-from-arrival-lists.mjs [--apply]
//
// Adds real incoming stock (from 7 supplier "Arrival List" xlsx files, one per
// shipping container, created 2026-09-01 in Downloads/) to Erply for SKUs
// that already exist there -- matched by exact code (货号), never by
// barcode fallback (two SKUs in this batch, T-641397 and F286757, only
// matched an existing Erply product by barcode, not code -- deliberately
// excluded here pending Dragon's confirmation those are really the same
// product; see docs/memory for the read-only cross-check this was built from).
// Also excludes every SKU with no Erply match at all (38 genuinely-new
// products from this same batch -- those need saveProduct + English names/
// categories first, handled separately, not by this script).
//
// Quantity source is 总PCS (total pieces) per line, summed across all 7
// files when a SKU appears in more than one shipment -- backed by each
// row's own carton-count x pack-size, not QuickBooks' unreconciled running
// balance (see docs/LIVE-INVENTORY-COUNT-HANDOFF.md -- that qty is known-bad
// and deliberately not used anywhere in this script).
//
// Erply has no "set absolute stock" call, only deltas: saveInventoryRegistration
// (add) / saveInventoryWriteOff (remove). Every quantity here is a real
// arrival, so this only ever needs saveInventoryRegistration.
//
// Safety, matching this repo's established pattern for bulk Erply writes
// (see set-erply-stock-1000-test.mjs, create-missing-plush-in-erply.mjs):
// - Dry run by default, --apply required to write.
// - Backup CSV of planned changes written BEFORE any writes.
// - Batched (50 rows/request), warehouse 1 ("L&Y USA").
// - After --apply, independently re-fetches live stock to confirm.
//
// Requires in .env.local: ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { config } from 'dotenv'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const APPLY = process.argv.includes('--apply')
const WAREHOUSE_ID = 1 // "L&Y USA" -- confirmed via getWarehouses, see docs/memory/project-erply-pagination-fix.md
const CHUNK_SIZE = 50

const ERPLY_CLIENT_CODE = process.env.ERPLY_CLIENT_CODE
const ERPLY_USERNAME = process.env.ERPLY_USERNAME
const ERPLY_PASSWORD = process.env.ERPLY_PASSWORD
for (const [name, val] of Object.entries({ ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD })) {
  if (!val) { console.error(`Missing in .env.local: ${name}`); process.exit(1) }
}
const ERPLY_API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`

const DOWNLOADS = 'C:\\Users\\Dragon\\Downloads\\'
const ARRIVAL_FILES = [
  '2026-08 ETD 0807 722ctn Arrival List ETA 08-20-2026 Cntr#EMCU8524830 MBL#EGLV143655273884 HBL#EGLV143655273884.xlsx',
  '2026-08 ETD 0807 759ctn Arrival List ETA 08-20-2026 Cntr#EGHU8222347 MBL#EGLV143655273892 HBL#RWRD102613029707.xlsx',
  '2026-08 ETD 0814 762ctn Arrival List ETA 08-27-2026 Cntr#EGSU8749711 cntr#762 ETA 08-27-2026 MBL#EGLV143655274422 HBL#RWRD.xlsx',
  '2026-08 ETD 0814 971ctn Arrival List ETA Cntr#MAGU5284898 971ctn ETA 08-26-2026 MBL#EGLV143655273914 HBL#RWRD102613031116.xlsx',
  '2026-08 ETD 0820 568ctn Arrival List ETA 09-02-2026 Cntr#EGSU9509206 MBL#EGLV143655274431 HBL#RWRD102613030985.xlsx',
  '2026-08 ETD 0820 606ctn Arrival List ETA 09-02-2026 Cntr#EISU8351911 MBL#EGLV140602190726 HBL#RWRD102613031311.xlsx',
  '2026-08 ETD 0820 848ctn Arrival List ETA 09-02-2026 Cntr#EGSU8769003 MBL#EGLV143655274732 HBL#RWRD102613031230.xlsx',
]

// Known SKU-column junk from a footer row that isn't a real product (a
// container number that leaked into the 货号 column) -- excluded rather
// than silently registering 0 stock for a fake "SKU".
const IGNORE_SKUS = new Set(['EGSU8769003'])

const OUT_DIR = path.join(ROOT, 'data', 'erply-bulk-import')
const OUT_CSV = path.join(OUT_DIR, 'stock-additions-planned.csv')

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

function parseArrivalFile(filename) {
  const wb = XLSX.readFile(DOWNLOADS + filename)
  const sheetName = wb.SheetNames.includes('实装') ? '实装' : wb.SheetNames[0]
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null })
  const out = []
  for (const r of rows) {
    const sku = String(r['货号'] || '').trim()
    if (!sku || IGNORE_SKUS.has(sku.toUpperCase())) continue
    const pcs = Number(r['总PCS']) || 0
    out.push({ sku, pcs, sourceFile: filename })
  }
  return out
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
  const header = 'productID,sku,name,warehouseID,oldStock,addQty,newStock,shipments'
  const lines = rows.map((r) =>
    [r.productID, r.sku, esc(r.name), WAREHOUSE_ID, r.oldStock, r.addQty, r.oldStock + r.addQty, r.shipments].join(','))
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
  console.log(`${APPLY ? '' : '[DRY RUN] '}Reading ${ARRIVAL_FILES.length} arrival list files...`)
  let allRows = []
  for (const f of ARRIVAL_FILES) allRows.push(...parseArrivalFile(f))
  console.log(`  ${allRows.length} line items total`)

  const bySku = new Map()
  for (const r of allRows) {
    const key = r.sku.toUpperCase()
    if (!bySku.has(key)) bySku.set(key, { sku: r.sku, totalPcs: 0, files: new Set() })
    const e = bySku.get(key)
    e.totalPcs += r.pcs
    e.files.add(r.sourceFile)
  }
  console.log(`  ${bySku.size} distinct SKUs`)

  console.log('\nAuthenticating with Erply...')
  const auth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  const sessionKey = auth.records[0].sessionKey

  console.log(`Fetching all Erply products with stock (warehouse ${WAREHOUSE_ID})...`)
  const erplyBySku = await fetchAllErplyProducts(sessionKey)
  console.log(`  ${erplyBySku.size} Erply products loaded`)

  const changes = []
  let noMatch = 0
  for (const [key, entry] of bySku) {
    const erply = erplyBySku.get(key)
    if (!erply) { noMatch++; continue } // genuinely-new / barcode-only-match SKUs -- not this script's job
    if (entry.totalPcs <= 0) continue
    changes.push({
      productID: erply.productID,
      sku: entry.sku,
      name: erply.name,
      oldStock: erply.stockAtWarehouse,
      addQty: entry.totalPcs,
      shipments: entry.files.size,
    })
  }

  console.log(`\n=== Dry run summary ===`)
  console.log(`Exact SKU matches in Erply (this script's scope): ${changes.length}`)
  console.log(`No exact SKU match (skipped -- new products or barcode-only matches, handled separately): ${noMatch}`)
  console.log('\nPlanned changes:')
  for (const c of changes) {
    console.log(`  ${c.sku} (${(c.name || '').slice(0, 45)}): ${c.oldStock} -> ${c.oldStock + c.addQty} (+${c.addQty}, ${c.shipments} shipment(s))`)
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
