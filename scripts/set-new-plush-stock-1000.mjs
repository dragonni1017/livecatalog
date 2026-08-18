// set-new-plush-stock-1000.mjs
// Run with: node scripts/set-new-plush-stock-1000.mjs [--apply]
//
// Registers 1000 units of stock (warehouse 1, "L&Y USA") in Erply for the
// 10 of 12 new plush products that have a photo -- the 2 without one
// (P273810-60cm Unicorn, P273803-60cm Highland Cow) are deliberately
// excluded, left at 0 until they have a photo too.
//
// These are brand-new SKUs (created this session, see
// create-missing-plush-in-erply.mjs) with no prior inventory transactions,
// so current stock should read 0 -- confirmed live before computing the
// delta rather than assumed. Erply has no "set absolute stock" call, only
// deltas (saveInventoryRegistration to add), same mechanism as
// set-erply-stock-1000-test.mjs.
//
// Also updates Supabase's stock_qty to match immediately, since the
// Erply -> Supabase sync isn't live -- otherwise these would sit correct
// in Erply but still show "Out of Stock" on the storefront.
//
// Defaults to a dry run; pass --apply to write. Independently re-fetches
// both systems afterward to confirm.
//
// Requires in .env.local:
//   ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const APPLY = process.argv.includes('--apply')
const TARGET_STOCK = 1000
const WAREHOUSE_ID = 1 // "L&Y USA"

const ERPLY_CLIENT_CODE = process.env.ERPLY_CLIENT_CODE
const ERPLY_USERNAME = process.env.ERPLY_USERNAME
const ERPLY_PASSWORD = process.env.ERPLY_PASSWORD
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
for (const [name, val] of Object.entries({ ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_KEY })) {
  if (!val) { console.error(`Missing in .env.local: ${name}`); process.exit(1) }
}
const ERPLY_API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

// The 10 of 12 new plush SKUs that have a photo (Erply productID from
// create-missing-plush-in-erply.mjs). Excludes P273810-60cm (2879) and
// P273803-60cm (2882).
const TARGETS = [
  { sku: 'P273812-60cm', productID: 2873 },
  { sku: 'P273815-60cm', productID: 2874 },
  { sku: 'P273798-60cm', productID: 2875 },
  { sku: 'P273805-60cm', productID: 2876 },
  { sku: 'P273807-46cm', productID: 2877 },
  { sku: 'P273810-46cm', productID: 2878 },
  { sku: 'P273816-46cm', productID: 2880 },
  { sku: 'P273800-46cm', productID: 2881 },
  { sku: 'P273798-46cm', productID: 2883 },
  { sku: 'P273802-46cm', productID: 2884 },
]

const OUT_DIR = path.join(ROOT, 'data', 'plush-erply-import')
const OUT_CSV = path.join(OUT_DIR, 'stock-1000-changes.csv')

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

async function getStock(sessionKey, productID) {
  const data = await erplyPost({ request: 'getProducts', sessionKey, productID: String(productID), getStockInfo: '1' })
  const p = data.records?.[0]
  return p?.warehouses?.[String(WAREHOUSE_ID)]?.totalInStock ?? 0
}

async function main() {
  const auth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  const sessionKey = auth.records[0].sessionKey

  console.log('Checking current live stock for each target...')
  const changes = []
  for (const t of TARGETS) {
    const current = Number(await getStock(sessionKey, t.productID))
    const delta = TARGET_STOCK - current
    if (delta <= 0) {
      console.log(`  ${t.sku}: already at ${current} (>= target) -- skipping`)
      continue
    }
    changes.push({ ...t, oldStock: current, newStock: TARGET_STOCK, delta })
    console.log(`  ${t.sku}: ${current} -> ${TARGET_STOCK} (+${delta})`)
  }

  if (!APPLY) {
    console.log(`\nDry run only -- pass --apply to register +stock for ${changes.length} products and update Supabase.`)
    return
  }

  if (changes.length === 0) {
    console.log('\nNothing to apply.')
    return
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const csv = ['productID,sku,warehouseID,oldStock,newStock,delta', ...changes.map((c) => [c.productID, c.sku, WAREHOUSE_ID, c.oldStock, c.newStock, c.delta].join(','))].join('\n') + '\n'
  fs.writeFileSync(OUT_CSV, csv)
  console.log(`\nBackup written to ${path.relative(ROOT, OUT_CSV)}`)

  console.log('\nRegistering stock in Erply...')
  const params = { request: 'saveInventoryRegistration', sessionKey, warehouseID: String(WAREHOUSE_ID) }
  changes.forEach((c, i) => {
    params[`productID${i + 1}`] = String(c.productID)
    params[`amount${i + 1}`] = String(c.delta)
  })
  await erplyPost(params)
  console.log(`  registered ${changes.length} products`)

  console.log('\nUpdating Supabase stock_qty...')
  const { error } = await supabase.from('products').update({ stock_qty: TARGET_STOCK }).in('sku', changes.map((c) => c.sku))
  if (error) console.error(`  Supabase update failed: ${error.message}`)
  else console.log(`  updated ${changes.length} rows`)

  console.log('\nIndependently re-fetching to confirm...')
  const reAuth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  for (const c of changes) {
    const live = await getStock(reAuth.records[0].sessionKey, c.productID)
    console.log(`  ${c.sku}: Erply stock=${live}`)
  }
  const { data: check } = await supabase.from('products').select('sku, stock_qty').in('sku', changes.map((c) => c.sku))
  for (const row of check) console.log(`  ${row.sku}: Supabase stock_qty=${row.stock_qty}`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
