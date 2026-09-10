// extract-805-new-products-review.mjs
// Run with: node scripts/extract-805-new-products-review.mjs
//
// Pulls the "Not In Catalog (New)" sheet out of
// data/qbd-catalog-compare/prefixed-skus-catalog-status.xlsx (805 rows: QB
// items whose SKU had a parent-item word-prefix stripped -- see
// fix-fullqbd-sku-prefixes.mjs -- and have no matching product in Supabase
// by SKU or barcode) into its own standalone review file, organized by
// category and with QB's Quantity On Hand flagged as unreliable rather
// than presented as a real count -- same caveat found earlier this session
// against a different QB export (docs/LIVE-INVENTORY-COUNT-HANDOFF.md):
// QB's running qty drifts heavily out of sync with reality when purchase
// receipts aren't kept up, so a wildly negative or huge value here is a
// bookkeeping artifact, not evidence of real stock.
//
// Read-only. Writes a NEW xlsx to
// data/qbd-catalog-compare/805-new-products-review.xlsx, one sheet per
// original QB category prefix (Squishy, Plush, Backpack, etc.) plus an
// "All 805" sheet and a Summary sheet -- so Dragon can review one category
// at a time in Excel rather than one long undifferentiated list.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const SOURCE_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'prefixed-skus-catalog-status.xlsx')
const OUT_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', '805-new-products-review.xlsx')

function buildSheet(rows) {
  const ws = XLSX.utils.json_to_sheet(rows)
  ws['!cols'] = [
    { wch: 20 }, // original_qb_prefix
    { wch: 22 }, // qb_original_item
    { wch: 16 }, // fixed_sku (proposed real SKU)
    { wch: 50 }, // description (proposed name)
    { wch: 18 }, // qb_category
    { wch: 10 }, // qb_price
    { wch: 16 }, // qb_qty_on_hand (flagged unreliable)
    { wch: 16 }, // barcode
  ]
  ws['!autofilter'] = { ref: ws['!ref'] }
  return ws
}

function main() {
  if (!fs.existsSync(SOURCE_XLSX)) {
    console.error(`Source not found: ${SOURCE_XLSX} -- run review-prefixed-skus-catalog-status.mjs first`)
    process.exit(1)
  }
  const wb = XLSX.readFile(SOURCE_XLSX)
  const sheet = wb.Sheets['Not In Catalog (New)']
  if (!sheet) { console.error('Sheet "Not In Catalog (New)" not found in source'); process.exit(1) }
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null })
  console.log(`Read ${rows.length} rows from source`)

  // Re-shape: drop STATUS (redundant once split into its own file), add
  // a review_status column for Dragon to fill in, and flag price/qty gaps
  // explicitly so they're not missed in a long list.
  const reshaped = rows.map((r) => {
    const flags = []
    if (!r.qb_price) flags.push('no price from QB')
    const qty = Number(r.qb_qty_on_hand)
    if (!Number.isFinite(qty) || qty <= 0) flags.push('QB qty is 0/negative/blank -- not a real count, ignore')
    return {
      review_status: '', // blank for Dragon to fill in: e.g. "add" / "skip" / "already discontinued"
      original_qb_prefix: r.original_qb_prefix,
      proposed_sku: r.fixed_sku,
      qb_original_item: r.qb_original_item,
      proposed_name: r.description,
      qb_category: r.qb_category,
      qb_price: r.qb_price,
      qb_qty_on_hand_UNRELIABLE: r.qb_qty_on_hand,
      barcode: r.barcode,
      flags: flags.join(' | '),
    }
  })

  const byPrefix = new Map()
  for (const r of reshaped) {
    const key = r.original_qb_prefix || 'Other'
    if (!byPrefix.has(key)) byPrefix.set(key, [])
    byPrefix.get(key).push(r)
  }

  const wbOut = XLSX.utils.book_new()

  const summaryRows = [
    { metric: 'Total new products to review', value: reshaped.length },
    { metric: '', value: '' },
    { metric: '-- By category --', value: '' },
    ...[...byPrefix.entries()].sort((a, b) => b[1].length - a[1].length).map(([prefix, list]) => ({ metric: prefix, value: list.length })),
  ]
  const summarySheet = XLSX.utils.json_to_sheet(summaryRows, { skipHeader: false })
  summarySheet['!cols'] = [{ wch: 30 }, { wch: 10 }]
  XLSX.utils.book_append_sheet(wbOut, summarySheet, 'Summary')

  XLSX.utils.book_append_sheet(wbOut, buildSheet(reshaped), 'All 805')

  // One sheet per category, capped to keep sheet names <=31 chars and
  // valid (Excel forbids : \ / ? * [ ]).
  for (const [prefix, list] of [...byPrefix.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const safeName = prefix.replace(/[:\\/?*[\]]/g, '-').slice(0, 31)
    XLSX.utils.book_append_sheet(wbOut, buildSheet(list), safeName)
  }

  fs.mkdirSync(path.dirname(OUT_XLSX), { recursive: true })
  XLSX.writeFile(wbOut, OUT_XLSX)
  console.log(`\nWrote ${path.relative(ROOT, OUT_XLSX)}`)
  console.log(`Sheets: Summary, All 805, + one per category (${byPrefix.size} categories)`)
}

main()
