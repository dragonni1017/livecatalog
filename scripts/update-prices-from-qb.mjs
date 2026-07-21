// update-prices-from-qb.mjs
// Run with: node scripts/update-prices-from-qb.mjs [path/to/QB_vs_Catalog_Price_Comparison.xlsx] [--apply]
// (defaults to data/price-comparisons/QB_vs_Catalog_Price_Comparison.xlsx)
// One-time correction: reads the vetted "Price Differences" sheet (QB Item
// Price List vs. catalog, real nonzero QB prices only — $0.00 QB placeholder
// rows are already excluded from that sheet) and updates products.price_cents
// in Supabase, matched by SKU. Defaults to a dry run; pass --apply to write.

import { createClient } from '@supabase/supabase-js'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.local') })

const APPLY = process.argv.includes('--apply')
const XLSX_PATH =
  process.argv.slice(2).find((a) => !a.startsWith('--')) ||
  resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'price-comparisons', 'QB_vs_Catalog_Price_Comparison.xlsx')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing Supabase env vars. Make sure .env.local is set up.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function readQbPrices(path) {
  const wb = XLSX.readFile(path)
  const sheet = wb.Sheets['Price Differences']
  if (!sheet) {
    console.error(`Sheet "Price Differences" not found in ${path}`)
    process.exit(1)
  }
  const rows = XLSX.utils.sheet_to_json(sheet)
  const map = {}
  for (const row of rows) {
    const sku = String(row['SKU'] || '').trim()
    const qbPrice = Number(row['QB Price'])
    if (!sku || !Number.isFinite(qbPrice)) continue
    map[sku.toUpperCase()] = qbPrice
  }
  return map
}

async function fetchAllProducts() {
  const all = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('products')
      .select('id, sku, price_cents')
      .range(from, from + PAGE - 1)
    if (error) { console.error('Supabase read error:', error.message); process.exit(1) }
    all.push(...data)
    if (data.length < PAGE) break
  }
  return all
}

async function main() {
  console.log(`${APPLY ? '' : '[DRY RUN] '}Reading QB prices from: ${XLSX_PATH}`)
  const skuToQbPrice = readQbPrices(XLSX_PATH)
  console.log(`SKUs in Price Differences sheet: ${Object.keys(skuToQbPrice).length}`)

  const products = await fetchAllProducts()
  console.log(`Products in Supabase:             ${products.length}`)

  const toUpdate = []
  let alreadyCorrect = 0
  let notFound = 0
  for (const [sku, qbPrice] of Object.entries(skuToQbPrice)) {
    const product = products.find((p) => (p.sku || '').toUpperCase() === sku)
    if (!product) { notFound++; continue }
    const qbPriceCents = Math.round(qbPrice * 100)
    if (product.price_cents === qbPriceCents) { alreadyCorrect++; continue }
    toUpdate.push({ id: product.id, sku: product.sku, from: product.price_cents, to: qbPriceCents })
  }

  console.log(`\nAlready matches QB:               ${alreadyCorrect}`)
  console.log(`SKU not found in catalog:         ${notFound}`)
  console.log(`To update:                        ${toUpdate.length}`)

  if (toUpdate.length === 0) {
    console.log('\nNothing to update. Done.')
    return
  }

  console.log(`\n${APPLY ? 'Applying' : '[DRY RUN] Would apply'} changes:`)
  toUpdate.forEach((u) =>
    console.log(`  ${u.sku}: $${(u.from / 100).toFixed(2)} -> $${(u.to / 100).toFixed(2)}`),
  )

  if (!APPLY) {
    console.log('\n[DRY RUN] No writes performed. Re-run with --apply to write these changes.')
    return
  }

  let updated = 0
  let failed = 0
  for (const u of toUpdate) {
    const { error } = await supabase
      .from('products')
      .update({ price_cents: u.to, updated_at: new Date().toISOString() })
      .eq('id', u.id)
    if (error) {
      console.error(`  Failed ${u.sku}: ${error.message}`)
      failed++
    } else {
      updated++
    }
  }

  console.log(`\nDone. Updated ${updated} of ${toUpdate.length} products (failures: ${failed}).`)
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
