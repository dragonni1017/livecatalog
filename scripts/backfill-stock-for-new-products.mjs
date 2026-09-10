// backfill-stock-for-new-products.mjs
// Run with: node scripts/backfill-stock-for-new-products.mjs
//
// The daily Erply sync (app/api/sync/route.ts) deliberately skips
// stock_qty on every run (skipFields) to avoid mass-overwriting existing
// stock numbers -- see lib/product-sync.ts. That means any BRAND NEW
// product inserted by that sync gets stock_qty=0 on its first insert and
// never gets a real number until something else backfills it.
//
// This is a narrow, one-off fix: only touches products with no prior
// stock_qty history (created very recently, still at the 0 they were
// inserted with) -- pulls real live stock from Erply's warehouses field
// and writes it in for just those. Does NOT touch any other product's
// stock_qty, unlike the full sync.
//
// Run with: node scripts/backfill-stock-for-new-products.mjs
//           node scripts/backfill-stock-for-new-products.mjs --since=2026-09-01T20:00:00Z
//           node scripts/backfill-stock-for-new-products.mjs --dry-run
//
// Requires in .env.local: ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD,
// NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import path from 'path'
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

for (const [name, val] of Object.entries({ ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_KEY })) {
  if (!val) { console.error(`Missing in .env.local: ${name}`); process.exit(1) }
}

const DRY_RUN = process.argv.includes('--dry-run')
const sinceArg = process.argv.find((a) => a.startsWith('--since='))
const SINCE = sinceArg ? sinceArg.split('=')[1] : '2026-09-01T20:00:00Z' // today's new-product sync window

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
const ERPLY_API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`
let sessionKey = null

async function erplyPost(params) {
  if (!sessionKey) {
    const body = new URLSearchParams({ clientCode: ERPLY_CLIENT_CODE, request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
    const res = await fetch(ERPLY_API_URL, { method: 'POST', body })
    const json = await res.json()
    sessionKey = json.records[0].sessionKey
  }
  const body = new URLSearchParams({ clientCode: ERPLY_CLIENT_CODE, sessionKey, ...params })
  const res = await fetch(ERPLY_API_URL, { method: 'POST', body })
  return res.json()
}

async function fetchActiveErplyStock() {
  const bySku = new Map()
  async function page(pageNo) {
    const data = await erplyPost({ request: 'getProducts', recordsOnPage: '300', pageNo: String(pageNo), getStockInfo: '1', active: '1' })
    return { products: data.records ?? [], total: data.status?.recordsTotal ?? 0 }
  }
  const first = await page(1)
  let all = [...first.products]
  let pageNo = 2
  while (all.length < first.total) {
    const { products } = await page(pageNo)
    if (products.length === 0) break
    all.push(...products)
    pageNo++
  }
  for (const p of all) {
    const sku = (p.code || String(p.productID)).trim().toUpperCase()
    const stockQty = Object.values(p.warehouses ?? {}).reduce((sum, w) => sum + (w.totalInStock ?? 0), 0)
    bySku.set(sku, stockQty)
  }
  return bySku
}

async function main() {
  console.log(`Loading Supabase products created since ${SINCE} (still at their insert-time stock_qty)...`)
  const { data: newRows, error } = await supabase
    .from('products')
    .select('id, sku, stock_qty')
    .gte('created_at', SINCE)
  if (error) { console.error(error.message); process.exit(1) }
  console.log(`  ${newRows.length} products in that window`)

  console.log('Fetching live Erply stock for all active products...')
  const stockBySku = await fetchActiveErplyStock()
  console.log(`  ${stockBySku.size} active Erply products with stock info`)

  let updated = 0, noMatch = 0, alreadyNonzero = 0
  const rowsToUpdate = []
  for (const row of newRows) {
    if (row.stock_qty && row.stock_qty > 0) { alreadyNonzero++; continue }
    const sku = row.sku.trim().toUpperCase()
    const stock = stockBySku.get(sku)
    if (stock === undefined) { noMatch++; continue }
    rowsToUpdate.push({ id: row.id, sku: row.sku, stock })
  }

  const nonzeroIncoming = rowsToUpdate.filter((r) => r.stock > 0)
  console.log(`\n${rowsToUpdate.length} products to update, ${alreadyNonzero} already had stock, ${noMatch} had no Erply match`)
  console.log(`Of those ${rowsToUpdate.length}, ${nonzeroIncoming.length} have real (nonzero) stock in Erply right now.`)
  if (DRY_RUN) {
    console.log('--dry-run passed -- not writing. Sample:')
    for (const r of rowsToUpdate.slice(0, 15)) console.log(`  ${r.sku}: stock_qty -> ${r.stock}`)
    return
  }

  for (const r of rowsToUpdate) {
    const { error: updErr } = await supabase.from('products').update({ stock_qty: r.stock }).eq('id', r.id)
    if (updErr) {
      console.log(`  FAIL ${r.sku}: ${updErr.message}`)
      continue
    }
    updated++
  }
  console.log(`\nDone. updated=${updated}`)
}

main().catch((err) => { console.error('Fatal error:', err); process.exit(1) })
