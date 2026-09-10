// fix-fullqbd-sku-prefixes.mjs
// Run with: node scripts/fix-fullqbd-sku-prefixes.mjs
//
// QuickBooks Desktop's Item List export writes subitems as
// "ParentItemName:SubItemCode" (e.g. "Backpack:B320119", "Gift Bags:G331910")
// -- the parent is just a QB-side grouping label, not part of the real SKU,
// but it lands directly in the Item column with nothing to tell them apart
// from a genuine SKU. This silently broke the SKU match against Supabase in
// the earlier qbd-vs-catalog comparison (compare-fullqbd-to-catalog.mjs) --
// "Backpack:B320119" doesn't match a catalog SKU of "B320119".
//
// Confirmed live in Downloads/FullQBDList09042026.xlsx: 813 rows carry one
// of 26 distinct word-prefixes (Backpack, Coin Purse, Gift Bags, Plush,
// Squishy, Toys/Cars, etc.), 812 colon-separated + 1 space-only (inconsistent
// export, no colon that one time).
//
// Read-only against the source file -- writes a NEW xlsx (never overwrites
// Downloads/FullQBDList09042026.xlsx) to
// Downloads/FullQBDList09042026-sku-fixed.xlsx, same sheets/columns/row
// order, only the Item column changed for affected rows. A new
// "Original Item" column is added right after Item so the original QB value
// is never lost, in case a prefix strip is later found to be wrong for a
// specific row.

import path from 'path'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const SOURCE_PATH = 'C:\\Users\\Dragon\\Downloads\\FullQBDList09042026.xlsx'
const OUT_PATH = 'C:\\Users\\Dragon\\Downloads\\FullQBDList09042026-sku-fixed.xlsx'

function stripPrefix(item) {
  const colonMatch = item.match(/^([A-Za-z][A-Za-z /]+):(.+)$/)
  if (colonMatch) return { fixed: colonMatch[2].trim(), prefix: colonMatch[1].trim() }
  // The one confirmed space-only case ("Backpack B324479") -- only strip a
  // leading word if what remains still looks like a real SKU (starts with a
  // letter+digit or digit), so a genuinely single-word SKU with no prefix
  // (the vast majority of rows) is never touched.
  const spaceMatch = item.match(/^([A-Za-z][A-Za-z]+)\s+([A-Za-z]{0,3}\d\S*)$/)
  if (spaceMatch) return { fixed: spaceMatch[2].trim(), prefix: spaceMatch[1].trim() }
  return null
}

function main() {
  const wb = XLSX.readFile(SOURCE_PATH)
  const sheet = wb.Sheets['Sheet1']
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null })

  let fixedCount = 0
  const prefixCounts = new Map()
  const fixedRows = rows.map((row) => {
    const original = String(row.Item || '').trim()
    if (!original) return { ...row, 'Original Item': null }
    const result = stripPrefix(original)
    if (!result) return { ...row, 'Original Item': null }
    fixedCount++
    prefixCounts.set(result.prefix, (prefixCounts.get(result.prefix) || 0) + 1)
    return { ...row, Item: result.fixed, 'Original Item': original }
  })

  console.log(`Rows with a stripped word-prefix: ${fixedCount} / ${rows.length}`)
  console.log('\nBy prefix:')
  for (const [prefix, count] of [...prefixCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${prefix}: ${count}`)
  }

  // Reorder columns so "Original Item" sits right after "Item" (json_to_sheet
  // uses first-object key order to determine column order).
  const reordered = fixedRows.map((row) => {
    const { Item, 'Original Item': originalItem, ...rest } = row
    return { Item, 'Original Item': originalItem, ...rest }
  })

  const newSheet = XLSX.utils.json_to_sheet(reordered)
  const newWb = XLSX.utils.book_new()
  // Preserve the source's first (instructions) sheet as-is too, so the
  // output is a complete, standalone replacement file if needed.
  if (wb.Sheets['QuickBooks Desktop Export Tips']) {
    XLSX.utils.book_append_sheet(newWb, wb.Sheets['QuickBooks Desktop Export Tips'], 'QuickBooks Desktop Export Tips')
  }
  XLSX.utils.book_append_sheet(newWb, newSheet, 'Sheet1')
  XLSX.writeFile(newWb, OUT_PATH)

  console.log(`\nWrote ${path.basename(OUT_PATH)} (${rows.length} rows, ${fixedCount} SKUs corrected, original values preserved in "Original Item" column)`)
}

main()
