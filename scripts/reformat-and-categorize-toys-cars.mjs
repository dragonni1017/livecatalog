// reformat-and-categorize-toys-cars.mjs
// Run with: node scripts/reformat-and-categorize-toys-cars.mjs
//
// Same treatment as Squishy/Plush, for the 75-row Toys/Cars batch
// (data/qbd-catalog-compare/toys-cars-review-enriched.xlsx).
//
// CATEGORY, checked against live Erply (searchName lookups), not guessed:
//   - Generic toys -> groupID 56 "Toys" (confirmed live: 89 active
//     products, added 2026-06-03 -- the real established category, NOT the
//     near-empty groupID 69 "TOY" added 2026-09-01, same duplicate-group
//     pattern already found for Squishy/Backpack/Keychain).
//   - Bubble-related items (searchName "bubble" -> 21/24 sampled existing
//     products) -> groupID 13 "Bubbles", a real dedicated subcategory of
//     Toys (parentGroupID 56), added 2026-06-03.
//   - Squeeze Ball items (searchName "squeeze ball" -> 3/3) -> groupID 52
//     "Squishy / Slime", same category already confirmed for the Squishy
//     batch.
//   - Umbrella items (searchName "umbrella" -> 27/27) -> groupID 58
//     "Umbrella", a real dedicated category, added 2026-06-03.
//   These four subtypes were all QB-mis-filed under the "Toys/Cars" parent
//   in the original export -- QB's own category is not this catalog's
//   category.
//
// NAME reformatting is intentionally more conservative here than Squishy/
// Plush: Title Case + a small confirmed-typo dictionary only. This batch's
// pack-quantity notation is inconsistent and often dozen-based ("1dz/pk -
// 50pk/cs", "1pk-1dz - 50dz/cs") rather than the plain "Npcs/cs" seen in
// Squishy/Plush -- converting dozen-based quantities into lib/pack.ts's
// "N/pk Mbx/cs cs.Total" format would require multiplying by 12 on
// genuinely ambiguous phrasing, and a wrong multiply would silently
// corrupt the "+1 case" cart button's math. Only the plain, unambiguous
// "Npcs/cs" / "N/cs" forms (no "dz" involved) are converted, same as
// before; everything else keeps its original pack text as informational
// only (NOT machine-readable by the cart's case button) -- flagged as such
// per row so this isn't silently assumed fixed later.
//
// Read-only against the source file. Writes a NEW xlsx to
// data/qbd-catalog-compare/toys-cars-review-final.xlsx.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const SOURCE_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'toys-cars-review-enriched.xlsx')
const OUT_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'toys-cars-review-final.xlsx')

const KEEP_AS_IS = new Set(['w/', 'w', 'of', 'the', 'and', 'a', 'an', 'in', 'on', 'with', 'x', 'vs'])

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

// Only matches a flat count with NO "dz" (dozen) marker anywhere nearby --
// deliberately conservative, see header comment. Note: no LEADING \b on
// "dz" -- a digit immediately followed by "dz" (e.g. "1dz/pk") has no word
// boundary between the digit and the letter (both are \w characters), so
// \bdz\b alone would miss exactly the "1dz"/"12dz" forms this batch
// actually uses. Trailing \b (dz followed by "/", space, or end) is kept.
function extractFlatCaseCount(rawName) {
  if (/dz\b/i.test(rawName)) return null
  const m = rawName.match(/(\d+)\s*(?:pcs)?\s*\/\s*(?:cs|case)\b/i)
  return m ? Number(m[1]) : null
}
function stripFlatCaseCount(rawName) {
  return rawName.replace(/\s*-?\s*\d+\s*(?:pcs)?\s*\/\s*(?:cs|case)\b/i, '').trim()
}

// Small, confirmed set spotted by eye in this batch's 75 rows -- not a
// general spellchecker.
const TYPO_FIXES = [
  [/\bmsic\b/gi, 'Music'],
  [/\belphant\b/gi, 'Elephant'],
  [/\bballon\b/gi, 'Balloon'],
  [/\bstrech\b/gi, 'Stretch'],
]

function reformatName(rawName) {
  let name = String(rawName || '').trim()
  if (!name) return name
  const flatCount = extractFlatCaseCount(name)
  if (flatCount) name = stripFlatCaseCount(name)
  for (const [pattern, replacement] of TYPO_FIXES) name = name.replace(pattern, replacement)
  name = name.replace(/\s{2,}/g, ' ').replace(/[\s-]+$/, '').trim()
  name = toTitleCase(name)
  if (flatCount) name = `${name} - 1/pk ${flatCount}bx/cs cs.${flatCount}`
  return { name, hadDzPackInfo: /dz\b/i.test(rawName) }
}

const CATEGORIES = {
  TOYS: { id: 56, name: 'Toys' },
  BUBBLES: { id: 13, name: 'Bubbles' },
  SQUISHY: { id: 52, name: 'Squishy / Slime' },
  UMBRELLA: { id: 58, name: 'Umbrella' },
}

function pickCategory(name) {
  if (/\bumbrella\b/i.test(name)) return { group: CATEGORIES.UMBRELLA, reason: 'Name mentions "umbrella" -- real dedicated category (27/27 live precedent), not generic Toys' }
  if (/\bsqueeze\s*ball\b/i.test(name)) return { group: CATEGORIES.SQUISHY, reason: 'Squeeze Ball -- same category as Squishy batch (3/3 live precedent: all existing "squeeze ball" products use Squishy/Slime)' }
  if (/\bbubble\b/i.test(name)) return { group: CATEGORIES.BUBBLES, reason: 'Name mentions "bubble" -- real dedicated category (21/24 live precedent), not generic Toys' }
  return { group: CATEGORIES.TOYS, reason: null }
}

function main() {
  const wb = XLSX.readFile(SOURCE_XLSX)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Toys-Cars Review'], { defval: null })
  console.log(`Read ${rows.length} rows`)

  let renamed = 0
  const categoryTally = new Map()

  const final = rows.map((r) => {
    const original = r.proposed_name
    const { name: newName, hadDzPackInfo } = reformatName(original) || { name: original, hadDzPackInfo: false }
    if (newName !== original) renamed++

    const { group, reason } = pickCategory(original)
    categoryTally.set(group.name, (categoryTally.get(group.name) || 0) + 1)

    const notes = []
    if (reason) notes.push(reason)
    if (hadDzPackInfo) notes.push('Pack quantity uses dozen-based notation ("dz") -- left as informational text only, NOT converted to the cart\'s machine-readable pack-spec format (would require an unverified x12 multiply on ambiguous phrasing)')
    if (r.proposed_sku === 'T640215') notes.push('JUDGMENT CALL: "Water Gun w Carry Backpack" mentions backpack, but the backpack is part of the toy design (a water-tank harness), not a separate bag product -- kept as Toys')
    if (!r.qb_price) notes.push('NO PRICE from QB')

    return {
      ...r,
      original_proposed_name: original,
      proposed_name: newName,
      category_group_id: group.id,
      category_name: group.name,
      category_notes: notes.join(' | '),
    }
  })

  console.log(`Renamed: ${renamed} / ${rows.length}`)
  console.log('\nCategory distribution:')
  for (const [name, count] of categoryTally) console.log(`  ${name}: ${count}`)

  console.log('\nReassigned off default Toys:')
  final.filter((r) => r.category_name !== 'Toys').forEach((r) =>
    console.log(`  ${r.proposed_sku} -> ${r.category_name}: "${r.proposed_name}"`))

  const ws = XLSX.utils.json_to_sheet(final)
  ws['!cols'] = [
    { wch: 14 }, { wch: 20 }, { wch: 16 }, { wch: 22 }, { wch: 55 }, { wch: 18 },
    { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 30 }, { wch: 16 }, { wch: 16 },
    { wch: 55 }, { wch: 50 }, { wch: 14 }, { wch: 18 }, { wch: 65 },
  ]
  ws['!autofilter'] = { ref: ws['!ref'] }
  const wbOut = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wbOut, ws, 'Toys-Cars Final')
  fs.mkdirSync(path.dirname(OUT_XLSX), { recursive: true })
  XLSX.writeFile(wbOut, OUT_XLSX)
  console.log(`\nWrote ${path.relative(ROOT, OUT_XLSX)}`)
}

main()
