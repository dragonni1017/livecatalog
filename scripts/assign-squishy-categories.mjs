// assign-squishy-categories.mjs
// Run with: node scripts/assign-squishy-categories.mjs
//
// Assigns a real Erply groupID to each of the 231 Squishy-batch rows (from
// data/qbd-catalog-compare/squishy-review-reformatted.xlsx), checked
// against live Erply data rather than assumed:
//
// groupID 52 "Squishy / Slime" is the correct, established category for
// genuine squishy products -- confirmed live (107 active products already
// use it, created 2026-06-03, showInWebshop=1). It doesn't appear in a
// plain getProductGroups call (it's a subgroup of 56 "Toys", only found by
// querying productGroupID=52 directly) -- worth remembering for any future
// Erply category work in this account.
//
// IMPORTANT ACCOUNT-WIDE FINDING, not just about Squishy: this Erply
// account has TWO parallel sets of near-identically-named categories.
// The real, established one (added 2026-06-03, hundreds of products each)
// vs. a set of near-empty TOP-LEVEL groups added just 2026-09-01 with
// names matching QuickBooks' own category words (e.g. groupID 64
// "Backpack" has only 1 product; the real backpack category is groupID 4
// "Bags/Purses" with 136). Nothing in this repo's scripts ever created
// those Sept-1 groups (grepped for saveProductGroup/addProductGroup, no
// hits) -- they predate this session. Route new products to the
// established (June) categories, not the near-empty Sept-1 ones, unless
// checked live like this file does.
//
// Only one row in this batch needed reassignment off the default:
// B323529 "Backpack Lady Bug" -> groupID 4 "Bags/Purses" (real category),
// not 52 and not the near-empty "Backpack" group.
//
// Read-only. Writes a NEW xlsx with a category_group_id / category_name /
// category_notes column added to every row.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const SOURCE_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'squishy-review-reformatted.xlsx')
const OUT_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'squishy-review-categorized.xlsx')

const DEFAULT_GROUP = { id: 52, name: 'Squishy / Slime' }

// Confirmed live against real precedent -- see header comment.
const OVERRIDES = {
  B323529: { id: 4, name: 'Bags/Purses', note: 'Name does not mention squishy at all ("Backpack Lady Bug") -- reassigned to the real, established backpack/bag category (groupID 4, 136 active products), not Squishy/Slime and not the near-empty groupID 64 "Backpack" (2026-09-01, 1 product).' },
}

// Squishy-named items that are ALSO keychains -- no direct precedent found
// either way (checked live Erply for existing "squishy"+"keychain" named
// products, zero results). Kept in Squishy/Slime since that's their
// primary stated nature, but flagged as a judgment call to confirm/override.
const JUDGMENT_CALL_KEYCHAINS = new Set(['S128017', 'S128715', 'S128719', 'S128721', 'S128911'])

function main() {
  if (!fs.existsSync(SOURCE_XLSX)) {
    console.error(`Source not found: ${SOURCE_XLSX} -- run reformat-squishy-names.mjs first`)
    process.exit(1)
  }
  const wb = XLSX.readFile(SOURCE_XLSX)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Squishy Reformatted'], { defval: null })
  console.log(`Read ${rows.length} rows`)

  let overridden = 0
  const withCategory = rows.map((r) => {
    const override = OVERRIDES[r.proposed_sku]
    const isJudgmentCall = JUDGMENT_CALL_KEYCHAINS.has(r.proposed_sku)
    if (override) overridden++

    const group = override ?? DEFAULT_GROUP
    const notes = []
    if (override) notes.push(override.note)
    if (isJudgmentCall) notes.push('JUDGMENT CALL: also a keychain, no direct precedent found either way -- kept in Squishy/Slime since "squishy" is the primary stated nature; confirm or move to a keychain category if you disagree.')

    return {
      ...r,
      category_group_id: group.id,
      category_name: group.name,
      category_notes: notes.join(' | '),
    }
  })

  console.log(`Reassigned off the default category: ${overridden}`)
  console.log(`Flagged as a judgment call (kept default, worth a second look): ${JUDGMENT_CALL_KEYCHAINS.size}`)

  const ws = XLSX.utils.json_to_sheet(withCategory)
  ws['!cols'] = [
    { wch: 14 }, { wch: 20 }, { wch: 16 }, { wch: 22 }, { wch: 55 }, { wch: 18 },
    { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 30 }, { wch: 16 }, { wch: 16 },
    { wch: 55 }, { wch: 50 }, { wch: 14 }, { wch: 18 }, { wch: 60 },
  ]
  ws['!autofilter'] = { ref: ws['!ref'] }
  const wbOut = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wbOut, ws, 'Squishy Categorized')
  XLSX.writeFile(wbOut, OUT_XLSX)
  console.log(`\nWrote ${path.relative(ROOT, OUT_XLSX)}`)
}

main()
