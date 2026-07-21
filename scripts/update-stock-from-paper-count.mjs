// update-stock-from-paper-count.mjs
// Run with: node scripts/update-stock-from-paper-count.mjs [path/to/paper-count.xlsx] [--apply]
// (defaults to paper-count-7-10-26.xlsx in repo root)
// One-time correction: reads the "Paper Count" sheet (physical stock count,
// "Total pieces" per SKU) and updates products.stock_qty in Supabase, matched
// by SKU. Rows on the "Skipped-Uncertain" sheet are reported but never
// applied — those counts were flagged uncertain by the counter. Defaults to
// a dry run; pass --apply to write.

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
  resolve(dirname(fileURLToPath(import.meta.url)), '..', 'paper-count-7-10-26.xlsx')

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing Supabase env vars. Make sure .env.local is set up.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function readCounts(path) {
  const wb = XLSX.readFile(path)
  const sheet = wb.Sheets['Paper Count 7-10-26']
  if (!sheet) {
    console.error(`Sheet "Paper Count 7-10-26" not found in ${path}`)
    process.exit(1)
  }
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }).slice(1).filter((r) => r[0])
  const map = {}
  for (const row of rows) {
    const sku = String(row[0] || '').trim()
    const totalPieces = Number(row[3])
    if (!sku || !Number.isFinite(totalPieces)) continue
    map[sku.toUpperCase()] = totalPieces
  }
  return map
}

function readSkippedSkus(path) {
  const wb = XLSX.readFile(path)
  const sheet = wb.Sheets['Skipped-Uncertain']
  if (!sheet) return []
  return XLSX.utils
    .sheet_to_json(sheet, { header: 1, defval: null })
    .slice(1)
    .filter((r) => r[0])
    .map((r) => String(r[0]).trim().toUpperCase())
}

async function fetchAllProducts() {
  const all = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('products')
      .select('id, sku, stock_qty, is_active')
      .range(from, from + PAGE - 1)
    if (error) { console.error('Supabase read error:', error.message); process.exit(1) }
    all.push(...data)
    if (data.length < PAGE) break
  }
  return all
}

async function main() {
  console.log(`${APPLY ? '' : '[DRY RUN] '}Reading paper count from: ${XLSX_PATH}`)
  const skuToCount = readCounts(XLSX_PATH)
  const skippedSkus = readSkippedSkus(XLSX_PATH)
  console.log(`SKUs in paper count sheet: ${Object.keys(skuToCount).length}`)
  console.log(`SKUs flagged skipped/uncertain (not applied): ${skippedSkus.length}`)

  const products = await fetchAllProducts()
  console.log(`Products in Supabase:      ${products.length}`)

  const toUpdate = []
  let alreadyCorrect = 0
  let notFound = 0
  const notFoundSkus = []
  for (const [sku, totalPieces] of Object.entries(skuToCount)) {
    const product = products.find((p) => (p.sku || '').toUpperCase() === sku)
    if (!product) { notFound++; notFoundSkus.push(sku); continue }
    if (product.stock_qty === totalPieces) { alreadyCorrect++; continue }
    toUpdate.push({
      id: product.id,
      sku: product.sku,
      from: product.stock_qty,
      to: totalPieces,
      isActive: product.is_active,
    })
  }

  console.log(`\nAlready matches paper count: ${alreadyCorrect}`)
  console.log(`SKU not found in catalog:    ${notFound}`)
  if (notFoundSkus.length) console.log(`  -> ${notFoundSkus.join(', ')}`)
  console.log(`To update:                   ${toUpdate.length}`)

  const skippedInCatalog = skippedSkus.filter((sku) =>
    products.some((p) => (p.sku || '').toUpperCase() === sku),
  )
  console.log(`\nSkipped/uncertain SKUs that exist in catalog (left untouched):`)
  skippedInCatalog.forEach((sku) => {
    const p = products.find((p) => (p.sku || '').toUpperCase() === sku)
    console.log(`  ${sku}: current stock_qty=${p.stock_qty}`)
  })

  if (toUpdate.length === 0) {
    console.log('\nNothing to update. Done.')
    return
  }

  console.log(`\n${APPLY ? 'Applying' : '[DRY RUN] Would apply'} changes:`)
  toUpdate.forEach((u) =>
    console.log(`  ${u.sku}${u.isActive ? '' : ' (inactive)'}: ${u.from} -> ${u.to}`),
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
      .update({ stock_qty: u.to, updated_at: new Date().toISOString() })
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
