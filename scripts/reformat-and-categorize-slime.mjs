// reformat-and-categorize-slime.mjs
// Run with: node scripts/reformat-and-categorize-slime.mjs
//
// Same treatment as the earlier batches, for the 74-row Slime batch
// (data/qbd-catalog-compare/slime-review-enriched.xlsx).
//
// CATEGORY: groupID 52 "Squishy / Slime" for all 74 -- confirmed live
// (searchName "slime" -> 24/31 sampled existing products use this group,
// the same real established category already confirmed for the Squishy
// batch). Unlike Toys/Cars, this batch has no genuinely different
// sub-types mis-filed in it -- the "Bubbles"/"Squishy" word overlaps found
// (S141011 "Slime Flowers", S145729 "Silk Slime Bubbles") are just
// descriptive product words, not evidence of mis-filing; both stay in
// Squishy/Slime.
//
// NAME reformatting: same conservative dz-aware approach as Toys/Cars
// (only a plain, unambiguous "Npcs/cs"/"N/cs" gets converted to the real
// pack-spec suffix; dozen-based notation is left as informational text
// only). Plus a few confirmed typo/garbled-data fixes spotted in this
// batch specifically: "Buvket" -> "Bucket", "10dx/cs" -> "10dz/cs" (a "dz"
// typo, not a real different unit), a stray "Slime :" colon prefix
// dropped, and a stray "$/bx" fragment (leftover from some spreadsheet
// artifact, not real product info) removed from S145629.
//
// Read-only against the source file. Writes a NEW xlsx to
// data/qbd-catalog-compare/slime-review-final.xlsx.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const SOURCE_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'slime-review-enriched.xlsx')
const OUT_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'slime-review-final.xlsx')

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

function extractFlatCaseCount(rawName) {
  if (/dz\b/i.test(rawName)) return null
  const m = rawName.match(/(\d+)\s*(?:pcs)?\s*\/\s*(?:cs|ctn|case)\b/i)
  return m ? Number(m[1]) : null
}
function stripFlatCaseCount(rawName) {
  return rawName.replace(/\s*-?\s*\d+\s*(?:pcs)?\s*\/\s*(?:cs|ctn|case)\b/i, '').trim()
}

const TYPO_FIXES = [
  [/\bbuvket\b/gi, 'Bucket'],
  [/(\d+)dx\/cs/gi, '$1dz/cs'], // "10dx/cs" -> "10dz/cs" -- confirmed typo, not a real unit
  [/^slime\s*:\s*/i, 'Slime '], // "Slime : Sand Slime-" -> "Slime Sand Slime-" (stray colon)
  [/\s*-?\s*\$\s*\/\s*bx\b/gi, ''], // stray "$/bx" fragment, not real product info
]

function reformatName(rawName) {
  let name = String(rawName || '').trim()
  if (!name) return { name, hadDzPackInfo: false }
  // Typo fixes (incl. "dx" -> "dz") run FIRST, so the dz-guard below and
  // extractFlatCaseCount both see the corrected unit -- doing this after
  // would miss a genuine dozen-based row whose only "dz" spelling was the
  // typo’d "dx" (found and fixed once already, see slime SKU s145627).
  for (const [pattern, replacement] of TYPO_FIXES) name = name.replace(pattern, replacement)
  const hadDzPackInfo = /dz\b/i.test(name)
  const flatCount = extractFlatCaseCount(name)
  if (flatCount) name = stripFlatCaseCount(name)
  name = name.replace(/\s{2,}/g, ' ').replace(/[\s-]+$/, '').trim()
  name = toTitleCase(name)
  if (flatCount) name = `${name} - 1/pk ${flatCount}bx/cs cs.${flatCount}`
  return { name, hadDzPackInfo }
}

const SLIME_GROUP = { id: 52, name: 'Squishy / Slime' }

function main() {
  const wb = XLSX.readFile(SOURCE_XLSX)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Slime Review'], { defval: null })
  console.log(`Read ${rows.length} rows`)

  let renamed = 0
  const final = rows.map((r) => {
    const original = r.proposed_name
    const { name: newName, hadDzPackInfo } = reformatName(original)
    if (newName !== original) renamed++

    const notes = []
    if (hadDzPackInfo) notes.push('Pack quantity uses dozen-based notation ("dz") -- left as informational text only, NOT converted to the cart\'s machine-readable pack-spec format (would require an unverified x12 multiply on ambiguous phrasing)')
    if (r.proposed_sku === 'S145729') notes.push('JUDGMENT CALL: name also mentions "Bubbles" ("Silk Slime Bubbles") -- kept in Squishy/Slime since it reads as a slime product with a bubble-shaped variant, not an actual bubble-blowing toy; confirm if you disagree')
    if (!r.qb_price) notes.push('NO PRICE from QB')

    return {
      ...r,
      original_proposed_name: original,
      proposed_name: newName,
      category_group_id: SLIME_GROUP.id,
      category_name: SLIME_GROUP.name,
      category_notes: notes.join(' | '),
    }
  })

  console.log(`Renamed: ${renamed} / ${rows.length}`)
  console.log('\nSample renames:')
  final.filter((r) => r.original_proposed_name !== r.proposed_name).slice(0, 20).forEach((r) =>
    console.log(`  "${r.original_proposed_name}" -> "${r.proposed_name}"`))

  const ws = XLSX.utils.json_to_sheet(final)
  ws['!cols'] = [
    { wch: 14 }, { wch: 20 }, { wch: 16 }, { wch: 22 }, { wch: 55 }, { wch: 18 },
    { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 30 }, { wch: 16 }, { wch: 16 },
    { wch: 55 }, { wch: 50 }, { wch: 14 }, { wch: 18 }, { wch: 65 },
  ]
  ws['!autofilter'] = { ref: ws['!ref'] }
  const wbOut = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wbOut, ws, 'Slime Final')
  fs.mkdirSync(path.dirname(OUT_XLSX), { recursive: true })
  XLSX.writeFile(wbOut, OUT_XLSX)
  console.log(`\nWrote ${path.relative(ROOT, OUT_XLSX)}`)
}

main()
