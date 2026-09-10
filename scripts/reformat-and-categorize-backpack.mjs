// reformat-and-categorize-backpack.mjs
// Run with: node scripts/reformat-and-categorize-backpack.mjs
//
// Same treatment as the earlier batches, for the 56-row Backpack batch
// (data/qbd-catalog-compare/backpack-review-enriched.xlsx).
//
// CATEGORY: groupID 4 "Bags/Purses" for all 56 -- confirmed live earlier
// this session (searchName "backpack" -> 27/29 sampled existing products
// use groupID 4, 136 active products total, added 2026-06-03). NOT the
// near-empty groupID 64 "Backpack" (added 2026-09-01, 1 product) -- same
// duplicate-group pattern already found repeatedly this session. The 2
// items flagged by the generic mismatch check (B323630, B323832, both
// "...Plush Backpack...") are still genuinely backpacks, just plush-
// material ones -- no reassignment needed, unlike Squishy's B323529 case.
//
// NAME reformatting: same conservative dz-aware pack-spec handling as
// Toys/Cars and Slime, plus fixes specific to this batch:
//   - "sequence" -> "Sequin" -- a recurring typo, confirmed by cross-
//     checking against the ~15 OTHER rows in this same batch that already
//     spell it correctly ("Sequin"), e.g. B324043 "Backpack Sequince w
//     Bow" (also has its own typo, separately fixed) vs B324877 "mermaid
//     tail sequence backpack" -- "sequence" clearly means the sparkly
//     material, not literal order/sequence.
//   - "Sequince" -> "Sequin" (single stray occurrence, same root typo).
//   - "back pack" / "Back Pack" -> "Backpack" (this batch's own QB parent
//     item is literally "Backpack" -- the split spelling is inconsistent
//     with the vast majority of rows already using the joined form).
//   - A stray "Backpack:" colon prefix (echoing the QB parent-item prefix
//     this whole file's SKUs were extracted from) dropped from a few rows
//     that kept it inside the description itself.
//
// Read-only against the source file. Writes a NEW xlsx to
// data/qbd-catalog-compare/backpack-review-final.xlsx.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const SOURCE_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'backpack-review-enriched.xlsx')
const OUT_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'backpack-review-final.xlsx')

const KEEP_AS_IS = new Set(['w/', 'w', 'of', 'the', 'and', 'a', 'an', 'in', 'on', 'with', 'x'])

function toTitleCase(str) {
  return str
    .split(/\s+/)
    .map((word, i) => {
      if (!word) return word
      const lower = word.toLowerCase()
      if (i > 0 && KEEP_AS_IS.has(lower)) return lower
      const first = word.charAt(0)
      if (first >= 'a' && first <= 'z') return first.toUpperCase() + word.slice(1)
      return word
    })
    .join(' ')
}

// A few rows spell the case-suffix as "c/s" instead of "/cs" (e.g. "48pcs
// c/s") -- same meaning, just letters transposed around the slash.
// Normalizing this BEFORE extraction/stripping means those rows get the
// same safe conversion as the rest, instead of silently falling through to
// "leave as informational text" for no real reason (found while reviewing
// this batch's own first-pass output -- 3 rows using "c/s" weren't
// converted even though they had no "dz" ambiguity at all).
function normalizeCaseSuffix(rawName) {
  return rawName.replace(/\bc\s*\/\s*s\b/gi, '/cs')
}

function extractFlatCaseCount(rawName) {
  if (/dz\b/i.test(rawName)) return null
  const m = normalizeCaseSuffix(rawName).match(/(\d+)\s*(?:pcs)?\s*\/\s*(?:cs|case)\b/i)
  return m ? Number(m[1]) : null
}
function stripFlatCaseCount(rawName) {
  return normalizeCaseSuffix(rawName).replace(/\s*-?\s*\d+\s*(?:pcs)?\s*\/\s*(?:cs|case)\b/i, '').trim()
}

const TYPO_FIXES = [
  [/\bsequence\b/gi, 'Sequin'],
  [/\bsequince\b/gi, 'Sequin'],
  [/\bback\s*pack\b/gi, 'Backpack'],
  [/^backpack\s*:\s*/i, 'Backpack '],
]

function reformatName(rawName) {
  let name = String(rawName || '').trim()
  if (!name) return { name, hadDzPackInfo: false }
  for (const [pattern, replacement] of TYPO_FIXES) name = name.replace(pattern, replacement)
  const hadDzPackInfo = /dz\b/i.test(name)
  const flatCount = extractFlatCaseCount(name)
  if (flatCount) name = stripFlatCaseCount(name)
  name = name.replace(/\s{2,}/g, ' ').replace(/[\s-]+$/, '').trim()
  name = toTitleCase(name)
  if (flatCount) name = `${name} - 1/pk ${flatCount}bx/cs cs.${flatCount}`
  return { name, hadDzPackInfo }
}

const BAG_GROUP = { id: 4, name: 'Bags/Purses' }

function main() {
  const wb = XLSX.readFile(SOURCE_XLSX)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Backpack Review'], { defval: null })
  console.log(`Read ${rows.length} rows`)

  let renamed = 0
  const final = rows.map((r) => {
    const original = r.proposed_name
    const { name: newName, hadDzPackInfo } = reformatName(original)
    if (newName !== original) renamed++

    const notes = []
    if (hadDzPackInfo) notes.push('Pack quantity uses dozen-based notation ("dz") -- left as informational text only, NOT converted to the cart\'s machine-readable pack-spec format (would require an unverified x12 multiply on ambiguous phrasing)')
    if (!r.qb_price) notes.push('NO PRICE from QB')

    return {
      ...r,
      original_proposed_name: original,
      proposed_name: newName,
      category_group_id: BAG_GROUP.id,
      category_name: BAG_GROUP.name,
      category_notes: notes.join(' | '),
    }
  })

  console.log(`Renamed: ${renamed} / ${rows.length}`)
  console.log('\nAll renames:')
  final.filter((r) => r.original_proposed_name !== r.proposed_name).forEach((r) =>
    console.log(`  "${r.original_proposed_name}" -> "${r.proposed_name}"`))

  const ws = XLSX.utils.json_to_sheet(final)
  ws['!cols'] = [
    { wch: 14 }, { wch: 20 }, { wch: 16 }, { wch: 22 }, { wch: 55 }, { wch: 18 },
    { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 30 }, { wch: 16 }, { wch: 16 },
    { wch: 55 }, { wch: 50 }, { wch: 14 }, { wch: 18 }, { wch: 65 },
  ]
  ws['!autofilter'] = { ref: ws['!ref'] }
  const wbOut = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wbOut, ws, 'Backpack Final')
  fs.mkdirSync(path.dirname(OUT_XLSX), { recursive: true })
  XLSX.writeFile(wbOut, OUT_XLSX)
  console.log(`\nWrote ${path.relative(ROOT, OUT_XLSX)}`)
}

main()
