// review-prefixed-skus-catalog-status.mjs
// Run with: node scripts/review-prefixed-skus-catalog-status.mjs
//
// Focused follow-up to compare-fullqbd-to-catalog.mjs, scoped to just the
// 813 rows fix-fullqbd-sku-prefixes.mjs corrected (SKUs that had a QB
// parent-item word prefix like "Backpack:" stripped off -- see that
// script's header). Of those 813, 8 have a SKU that also exists in
// Supabase -- but checking the actual product names (not just the SKU
// string) found only 1 of those 8 is really the same product
// (T637677 "Lamps Tornado" / catalog "Tornado Lamp"). The other 7 are SKU
// COLLISIONS: the same code was reused for a completely unrelated product
// at some point (e.g. QB's B325081 "Backpack Sequin Cat Eyes" vs catalog's
// B325081 "Bugs Assortment Plush W/ Detachable Leash" -- 0% word overlap).
// Trusting a bare SKU match here would be actively dangerous -- e.g.
// registering stock against the wrong physical product -- so this script
// checks name similarity for every SKU match and reports collisions as
// their own category, not lumped in with real matches.
//
// The remaining 805 are real product categories (Backpacks, Coin Purses,
// Gift Bags, Plush, Squishy, Mesh Ball, etc.) with no matching Supabase
// product at all.
//
// The community (free) `xlsx` package this repo already uses can't
// reliably write cell fill colors -- that's a paid-tier SheetJS feature --
// so "highlighting" here means unmistakable structure instead: a STATUS
// column plus three separate sheets (confirmed same product / SKU
// collision / not in catalog), rather than relying on color that might not
// render.
//
// Read-only against Supabase and the source files. Writes a NEW xlsx to
// data/qbd-catalog-compare/prefixed-skus-catalog-status.xlsx.
//
// Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const QBD_FIXED_PATH = 'C:\\Users\\Dragon\\Downloads\\FullQBDList09042026-sku-fixed.xlsx'
const OUT_DIR = path.join(ROOT, 'data', 'qbd-catalog-compare')
const OUT_XLSX = path.join(OUT_DIR, 'prefixed-skus-catalog-status.xlsx')

async function loadCatalog() {
  const all = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('products')
      .select('sku, barcode, name, price_cents, stock_qty, category:categories!products_category_id_fkey(name)')
      .range(from, from + PAGE - 1)
    if (error) { console.error('Supabase read error:', error.message); process.exit(1) }
    all.push(...data)
    if (data.length < PAGE) break
  }
  return all
}

// Same lightweight word-overlap heuristic as compare-fullqbd-to-catalog.mjs
// -- not a strict diff, just enough to separate "same product, maybe
// reworded" from "clearly a different product entirely."
function words(s) {
  return new Set(
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2),
  )
}
function namesRoughlyMatch(a, b) {
  const wordsA = words(a)
  const wordsB = words(b)
  if (wordsA.size === 0 || wordsB.size === 0) return false
  const [shorter, longer] = wordsA.size <= wordsB.size ? [wordsA, wordsB] : [wordsB, wordsA]
  let overlap = 0
  for (const w of shorter) if (longer.has(w)) overlap++
  return overlap / shorter.size >= 0.4
}

function buildSheet(rows, columnWidths) {
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = columnWidths
  ws['!autofilter'] = { ref: ws['!ref'] }
  return ws
}

async function main() {
  console.log('Reading SKU-fixed QBD export...')
  const wb = XLSX.readFile(QBD_FIXED_PATH)
  const allRows = XLSX.utils.sheet_to_json(wb.Sheets['Sheet1'], { defval: null })
  const prefixed = allRows.filter((r) => r['Original Item'])
  console.log(`  ${prefixed.length} rows had a prefix stripped`)

  console.log('Loading full Supabase catalog...')
  const catalog = await loadCatalog()
  const bySku = new Map()
  const byBarcode = new Map()
  for (const p of catalog) {
    const sku = (p.sku || '').trim().toUpperCase()
    if (sku) bySku.set(sku, p)
    const barcode = (p.barcode || '').trim()
    if (barcode) byBarcode.set(barcode, p)
  }
  console.log(`  ${catalog.length} products loaded`)

  const confirmedMatch = []
  const skuCollision = []
  const notInCatalog = []

  for (const r of prefixed) {
    const fixedSku = String(r.Item || '').trim().toUpperCase()
    const barcode = String(r.Barcode || '').trim()
    let matched = bySku.get(fixedSku)
    let matchType = matched ? 'sku' : null
    if (!matched && barcode) {
      matched = byBarcode.get(barcode)
      if (matched) matchType = 'barcode'
    }

    const base = {
      original_qb_prefix: String(r['Original Item']).split(/[:\s]/)[0],
      qb_original_item: r['Original Item'],
      fixed_sku: r.Item,
      description: r.Description,
      qb_category: r.Category,
      qb_price: Number(r.Price) || '',
      qb_qty_on_hand: r['Quantity On Hand'],
      barcode: r.Barcode,
    }

    if (!matched) {
      notInCatalog.push({ STATUS: 'NOT IN CATALOG -- NEW', ...base })
      continue
    }

    const sameProduct = namesRoughlyMatch(r.Description, matched.name)
    const withMatch = {
      ...base,
      matched_by: matchType,
      catalog_sku: matched.sku,
      catalog_name: matched.name,
      catalog_price: (matched.price_cents / 100).toFixed(2),
      catalog_stock_qty: matched.stock_qty,
      catalog_category: matched.category?.name ?? '',
    }

    if (sameProduct) {
      confirmedMatch.push({ STATUS: 'ALREADY IN CATALOG -- CONFIRMED SAME PRODUCT', ...withMatch })
    } else {
      skuCollision.push({
        STATUS: 'SKU COLLISION -- SAME CODE, DIFFERENT PRODUCT (DO NOT TREAT AS A MATCH)',
        ...withMatch,
      })
    }
  }

  console.log(`\nConfirmed same product: ${confirmedMatch.length}`)
  console.log(`SKU collision (different product, same code): ${skuCollision.length}`)
  console.log(`Not in catalog (new): ${notInCatalog.length}`)

  const byPrefixCounts = new Map()
  for (const r of notInCatalog) {
    byPrefixCounts.set(r.original_qb_prefix, (byPrefixCounts.get(r.original_qb_prefix) || 0) + 1)
  }
  const summaryRows = [
    { metric: 'Total prefixed SKUs reviewed', value: prefixed.length },
    { metric: 'Confirmed same product (safe to treat as existing)', value: confirmedMatch.length },
    { metric: 'SKU collision -- same code, different product (see that sheet)', value: skuCollision.length },
    { metric: 'NOT in catalog (new)', value: notInCatalog.length },
    { metric: '', value: '' },
    { metric: '-- Not-in-catalog breakdown by original QB category prefix --', value: '' },
    ...[...byPrefixCounts.entries()].sort((a, b) => b[1] - a[1]).map(([prefix, count]) => ({ metric: prefix, value: count })),
  ]

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const wbOut = XLSX.utils.book_new()

  const summarySheet = XLSX.utils.json_to_sheet(summaryRows, { skipHeader: false })
  summarySheet['!cols'] = [{ wch: 60 }, { wch: 12 }]
  XLSX.utils.book_append_sheet(wbOut, summarySheet, 'Summary')

  const matchCols = [
    { wch: 20 }, { wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 45 }, { wch: 18 },
    { wch: 10 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 45 }, { wch: 12 },
    { wch: 12 }, { wch: 18 },
  ]
  XLSX.utils.book_append_sheet(wbOut, buildSheet(confirmedMatch, matchCols), 'Confirmed Same Product')
  XLSX.utils.book_append_sheet(wbOut, buildSheet(skuCollision, matchCols), 'SKU Collision (Diff Product)')

  const newCols = [
    { wch: 20 }, { wch: 22 }, { wch: 16 }, { wch: 45 }, { wch: 18 }, { wch: 10 }, { wch: 14 }, { wch: 16 },
  ]
  XLSX.utils.book_append_sheet(wbOut, buildSheet(notInCatalog, newCols), 'Not In Catalog (New)')

  XLSX.writeFile(wbOut, OUT_XLSX)
  console.log(`\nWrote ${path.relative(ROOT, OUT_XLSX)}`)
  console.log('Sheets: Summary, Confirmed Same Product, SKU Collision (Diff Product), Not In Catalog (New)')
}

main().catch((err) => { console.error('Fatal error:', err); process.exit(1) })
