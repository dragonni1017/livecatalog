// backfill-barcodes.mjs
// Run with: node scripts/backfill-barcodes.mjs [path/to.xlsx] [--dry-run]
// One-time backfill: reads barcodes from the source spreadsheet and updates
// products.barcode in Supabase, matched by SKU. Only numeric barcode values
// are used (coerced via String() and matched against /^\d+$/).

import { createClient } from '@supabase/supabase-js'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.local') })

const DRY_RUN = process.argv.includes('--dry-run')
const EXCEL_PATH =
  process.argv.slice(2).find((a) => !a.startsWith('--')) ||
  'C:/Users/thien/Downloads/ImageOrganization/ImageOrganization/_handoff/Erply_Product_Import_WC_Format_FINAL.xlsx'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing Supabase env vars. Make sure .env.local is set up.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

function readBarcodeMap(path) {
  const wb = XLSX.readFile(path)
  const sheet = wb.Sheets[wb.SheetNames[0]]
  // raw: false reads each cell's *formatted* text instead of its bare
  // numeric value. Without it, a barcode like "012345678905" comes back
  // as the number 12345678905 and loses its leading zero the moment it's
  // stringified below — a different (shorter) code than what's printed
  // anywhere else. This script only reads the SKU/Barcode columns, so
  // there's no Price/Stock-style numeric parsing here to break.
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false })
  // Also read the bare (default) values, purely so we can tell *when* the
  // raw:false re-read above actually recovered a stripped leading zero —
  // that diff is what gets logged to barcode_corrections for traceability
  // (see BARCODE-LEADING-ZERO-FIX-HANDOFF.md).
  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1 })

  const headers = rows[0] || []
  const skuIdx = headers.indexOf('SKU')
  const barcodeIdx = headers.indexOf('GTIN, UPC, EAN, or ISBN')

  if (skuIdx === -1 || barcodeIdx === -1) {
    console.error(`Could not find SKU and/or barcode columns in header: ${JSON.stringify(headers)}`)
    process.exit(1)
  }

  const map = {}
  const corrections = []
  let skipped = 0
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue
    const skuCell = row[skuIdx]
    const barcodeCell = row[barcodeIdx]
    if (skuCell === undefined || skuCell === null || String(skuCell).trim() === '') continue
    const key = String(skuCell).trim().toUpperCase()
    const value = String(barcodeCell ?? '').trim()
    if (!/^\d+$/.test(value)) {
      skipped++
      continue
    }
    map[key] = value

    const rawValue = String(rawRows[i]?.[barcodeIdx] ?? '').trim()
    if (/^\d+$/.test(rawValue) && rawValue !== value && value.length > rawValue.length) {
      corrections.push({ sku: key, column: 'GTIN, UPC, EAN, or ISBN', original: rawValue, corrected: value })
    }
  }
  return { map, skipped, corrections }
}

// Best-effort audit log: never throws, never blocks the actual barcode
// update — a logging failure (most likely the barcode_corrections table not
// existing yet) is just a warning, not a reason to abort the backfill.
async function logCorrections(corrections) {
  if (corrections.length === 0) return
  const { error } = await supabase.from('barcode_corrections').insert(
    corrections.map((c) => ({
      sku: c.sku,
      column_name: c.column,
      original_value: c.original,
      corrected_value: c.corrected,
      source: 'backfill',
    })),
  )
  if (error) {
    console.error(`\n⚠️  Could not log ${corrections.length} correction(s) to barcode_corrections: ${error.message}`)
    console.error('   (Run the table-creation SQL in BARCODE-LEADING-ZERO-FIX-HANDOFF.md if it doesn\'t exist yet.)')
  } else {
    console.log(`📝 Logged ${corrections.length} leading-zero correction(s) to barcode_corrections.`)
  }
}

async function fetchAllProducts() {
  const all = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('products')
      .select('id, sku, barcode')
      .range(from, from + PAGE - 1)
    if (error) { console.error('Supabase read error:', error.message); process.exit(1) }
    all.push(...data)
    if (data.length < PAGE) break
  }
  return all
}

async function main() {
  console.log(`${DRY_RUN ? '[DRY RUN] ' : ''}Reading barcodes from: ${EXCEL_PATH}`)
  const { map: skuToBarcode, skipped, corrections } = readBarcodeMap(EXCEL_PATH)
  console.log(`Sheet barcodes (numeric):     ${Object.keys(skuToBarcode).length}`)
  console.log(`Skipped (blank/non-digit):    ${skipped}`)
  console.log(`Leading-zero corrections:     ${corrections.length}`)

  const products = await fetchAllProducts()
  console.log(`Products in Supabase:         ${products.length}`)

  const toUpdate = []
  let alreadyCorrect = 0
  let noBarcode = 0
  for (const p of products) {
    const barcode = skuToBarcode[(p.sku || '').toUpperCase()]
    if (!barcode) { noBarcode++; continue }
    if (p.barcode === barcode) { alreadyCorrect++; continue }
    toUpdate.push({ id: p.id, sku: p.sku, barcode })
  }

  console.log(`\nAlready correct:              ${alreadyCorrect}`)
  console.log(`No barcode in sheet:          ${noBarcode}`)
  console.log(`To update:                    ${toUpdate.length}`)

  if (toUpdate.length === 0) {
    console.log('\nNothing to update. Done.')
    return
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Sample of changes (first 20):')
    toUpdate.slice(0, 20).forEach((u) => console.log(`  ${u.sku} -> ${u.barcode}`))
    if (corrections.length > 0) {
      console.log(`\n[DRY RUN] ${corrections.length} leading-zero correction(s) would be logged to barcode_corrections:`)
      corrections.slice(0, 20).forEach((c) => console.log(`  ${c.sku}: ${c.original} -> ${c.corrected}`))
    }
    console.log('\n[DRY RUN] No writes performed. Re-run without --dry-run to apply.')
    return
  }

  let updated = 0
  let failed = 0
  for (const u of toUpdate) {
    const { error } = await supabase
      .from('products')
      .update({ barcode: u.barcode, updated_at: new Date().toISOString() })
      .eq('id', u.id)
    if (error) {
      console.error(`  Failed ${u.sku}: ${error.message}`)
      failed++
    } else {
      updated++
    }
  }

  console.log(`\n✅ Done! Updated ${updated} of ${toUpdate.length} products (failures: ${failed}).`)

  await logCorrections(corrections)
}

main().catch((err) => {
  console.error('Error:', err)
  process.exit(1)
})
