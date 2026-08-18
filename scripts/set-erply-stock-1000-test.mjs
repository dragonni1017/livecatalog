// set-erply-stock-1000-test.mjs
//
// TEMPORARY connectivity test: sets live Erply stock (warehouse 1, "L&Y USA")
// to 1000 for every active product that has a real picture, so Dragon can
// confirm the Erply -> WooCommerce/WordPress stock pipeline actually moves
// data. Live Erply inventory for this whole catalog currently reads 0 in
// both warehouses (confirmed 2026-07-30 and re-confirmed 2026-08-17, see
// docs/memory/project-erply-pagination-fix.md) -- not a real physical count,
// so every matched product needs a +1000 delta.
//
// "Has a picture" uses the same definition as
// export-products-with-images-and-inventory.mjs: Supabase's products.image_url
// + needs_photo=false (NOT Erply's own getProducts `images` field, which
// under-reports badly -- see docs/memory/project-erply-image-backfill.md).
//
// Erply has no "set absolute stock" call -- only delta-based adjustments
// (saveInventoryRegistration to add, saveInventoryWriteOff to remove). Since
// current stock is 0 everywhere, this only ever needs saveInventoryRegistration
// (+1000). If re-run later when stock is no longer 0, it still computes a
// correct delta from live stock, but a negative delta would need
// saveInventoryWriteOff instead (not implemented here -- current stock is
// checked and the script refuses to run if it finds anything already above
// target, rather than guessing).
//
// Safety, matching this repo's established pattern for bulk Erply writes
// (see round-erply-prices-to-quarter.mjs):
// - Dry run by default, --apply required to write.
// - Writes a backup CSV (productID, sku, name, warehouseID, oldStock,
//   newStock) to data/erply-stock-1000-test/planned-changes.csv BEFORE any
//   writes happen -- this is what a revert script would replay.
// - Writes are batched (50 rows per saveInventoryRegistration document) since
//   Erply doesn't document a per-request row cap.
// - After --apply, re-fetches live stock independently to confirm the write
//   landed -- never trusts the writer's own per-call success count.
//
// THIS IS TEMPORARY TEST DATA, NOT A REAL INVENTORY COUNT. Revert it back
// once the pipeline test is done (see planned-changes.csv for what to
// reverse) -- reverting to 0 needs saveInventoryWriteOff with a valid
// reasonID, which is a separate lookup not done by this script.
//
// Run with: node scripts/set-erply-stock-1000-test.mjs           (dry run)
//           node scripts/set-erply-stock-1000-test.mjs --apply    (writes)
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

const TARGET_STOCK = 1000
const WAREHOUSE_ID = 1 // "L&Y USA" -- confirmed via getWarehouses, 2026-08-17
const CHUNK_SIZE = 50

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ERPLY_CLIENT_CODE = process.env.ERPLY_CLIENT_CODE
const ERPLY_USERNAME = process.env.ERPLY_USERNAME
const ERPLY_PASSWORD = process.env.ERPLY_PASSWORD

const missing = []
if (!SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL')
if (!SUPABASE_SERVICE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')
if (!ERPLY_CLIENT_CODE) missing.push('ERPLY_CLIENT_CODE')
if (!ERPLY_USERNAME) missing.push('ERPLY_USERNAME')
if (!ERPLY_PASSWORD) missing.push('ERPLY_PASSWORD')
if (missing.length > 0) {
  console.error(`Missing in .env.local: ${missing.join(', ')}`)
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const ERPLY_API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`
const OUT_DIR = path.join(ROOT, 'data', 'erply-stock-1000-test')
const OUT_CSV = path.join(OUT_DIR, 'planned-changes.csv')

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

async function fetchSupabaseProductsWithImages() {
  const all = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('products')
      .select('sku, name, image_url, needs_photo, is_active')
      .eq('is_active', true)
      .not('image_url', 'is', null)
      .range(from, from + PAGE - 1)
    if (error) { console.error('Supabase read error:', error.message); process.exit(1) }
    all.push(...data)
    if (data.length < PAGE) break
  }
  return all.filter((p) => !p.needs_photo)
}

async function fetchErplyProductsWithStock(sessionKey) {
  async function page(pageNo) {
    const data = await erplyPost({
      request: 'getProducts',
      sessionKey,
      recordsOnPage: '300',
      pageNo: String(pageNo),
      getStockInfo: '1',
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

  const bySku = new Map()
  for (const p of all) {
    const sku = (p.code || String(p.productID)).trim().toUpperCase()
    const stockAtWarehouse = p.warehouses?.[String(WAREHOUSE_ID)]?.totalInStock ?? 0
    bySku.set(sku, { productID: p.productID, name: p.name, stockAtWarehouse })
  }
  return bySku
}

function toCsv(rows) {
  const header = 'productID,sku,name,warehouseID,oldStock,newStock,delta'
  const lines = rows.map((r) =>
    [r.productID, r.sku, `"${r.name.replace(/"/g, '""')}"`, WAREHOUSE_ID, r.oldStock, r.newStock, r.delta].join(','),
  )
  return [header, ...lines].join('\n') + '\n'
}

async function saveInventoryRegistrationBatch(sessionKey, chunk) {
  const params = { request: 'saveInventoryRegistration', sessionKey, warehouseID: String(WAREHOUSE_ID) }
  chunk.forEach((c, i) => {
    params[`productID${i + 1}`] = String(c.productID)
    params[`amount${i + 1}`] = String(c.delta)
  })
  return erplyPost(params)
}

async function main() {
  const apply = process.argv.includes('--apply')

  console.log('Fetching Supabase products with a real image_url...')
  const products = await fetchSupabaseProductsWithImages()
  console.log(`  ${products.length} active products with a picture`)

  console.log('Authenticating with Erply...')
  const auth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  const sessionKey = auth.records[0].sessionKey

  console.log(`Fetching live Erply stock (warehouse ${WAREHOUSE_ID})...`)
  const erplyBySku = await fetchErplyProductsWithStock(sessionKey)
  console.log(`  ${erplyBySku.size} active Erply products`)

  const changes = []
  let alreadyAtTarget = 0
  let noErplyMatch = 0
  const aboveTarget = []
  for (const p of products) {
    const erply = erplyBySku.get((p.sku || '').trim().toUpperCase())
    if (!erply) { noErplyMatch++; continue }
    const delta = TARGET_STOCK - erply.stockAtWarehouse
    if (delta === 0) { alreadyAtTarget++; continue }
    if (delta < 0) {
      // Would need saveInventoryWriteOff (requires a reasonID this script
      // doesn't look up) -- refuse rather than guess.
      aboveTarget.push({ sku: p.sku, current: erply.stockAtWarehouse })
      continue
    }
    changes.push({
      productID: erply.productID,
      sku: p.sku,
      name: erply.name,
      oldStock: erply.stockAtWarehouse,
      newStock: TARGET_STOCK,
      delta,
    })
  }

  console.log(`\n=== Dry run summary ===`)
  console.log(`Products with a picture:        ${products.length}`)
  console.log(`No matching active Erply SKU:    ${noErplyMatch}`)
  console.log(`Already at ${TARGET_STOCK}:               ${alreadyAtTarget}`)
  console.log(`Already above ${TARGET_STOCK} (skipped, needs a write-off, not handled here): ${aboveTarget.length}`)
  if (aboveTarget.length) {
    console.log('  ' + aboveTarget.slice(0, 10).map((a) => `${a.sku}=${a.current}`).join(', '))
  }
  console.log(`Would register (+delta):        ${changes.length}`)
  if (changes.length) {
    console.log('\nSample changes (first 10):')
    for (const c of changes.slice(0, 10)) {
      console.log(`  ${c.sku} (${c.name.slice(0, 40)}): ${c.oldStock} -> ${c.newStock} (+${c.delta})`)
    }
  }

  if (!apply) {
    console.log(`\nDry run only -- zero writes made. Re-run with --apply to write ${changes.length} stock changes to Erply.`)
    return
  }

  if (changes.length === 0) {
    console.log('\nNothing to apply. Done.')
    return
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(OUT_CSV, toCsv(changes))
  console.log(`\nBackup of planned changes written to ${path.relative(ROOT, OUT_CSV)} before any writes.`)

  console.log(`\n--apply set. Registering +stock for ${changes.length} products in warehouse ${WAREHOUSE_ID}, batches of ${CHUNK_SIZE}...`)
  let ok = 0
  let failed = 0
  const failedSkus = []
  for (let i = 0; i < changes.length; i += CHUNK_SIZE) {
    const chunk = changes.slice(i, i + CHUNK_SIZE)
    try {
      await saveInventoryRegistrationBatch(sessionKey, chunk)
      ok += chunk.length
      console.log(`  batch ${i / CHUNK_SIZE + 1}: ${chunk.length} products registered`)
    } catch (err) {
      failed += chunk.length
      chunk.forEach((c) => failedSkus.push(c.sku))
      console.error(`  batch ${i / CHUNK_SIZE + 1} FAILED (${chunk.length} products): ${err.message}`)
    }
  }
  console.log(`\nDone. ${ok} registered, ${failed} failed.`)
  if (failedSkus.length) console.log('Failed SKUs:', failedSkus.join(', '))

  console.log('\nRe-fetching live stock to independently verify the write (not trusting the batch success count)...')
  const reAuth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  const reErplyBySku = await fetchErplyProductsWithStock(reAuth.records[0].sessionKey)
  let verified = 0
  let mismatched = 0
  const mismatchSamples = []
  for (const c of changes) {
    const live = reErplyBySku.get(c.sku.trim().toUpperCase())
    if (live && Number(live.stockAtWarehouse) === c.newStock) {
      verified++
    } else {
      mismatched++
      if (mismatchSamples.length < 10) {
        mismatchSamples.push(`  ${c.sku}: expected ${c.newStock}, live is ${live?.stockAtWarehouse ?? 'MISSING'}`)
      }
    }
  }
  console.log(`Verified matching live: ${verified}/${changes.length}`)
  if (mismatched) {
    console.log(`MISMATCHED: ${mismatched}`)
    console.log(mismatchSamples.join('\n'))
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message)
  process.exitCode = 1
})
