// reformat-and-categorize-remaining-small.mjs
// Run with: node scripts/reformat-and-categorize-remaining-small.mjs
//
// Combined pass for the 5 smallest remaining QBD categories (11 items
// total) -- Eraser (3), Battery (2), Silicon Bag (2), Slipper/socks (2),
// Speakers (2). One script instead of five separate ones given how small
// each is, but each still gets its own output sheet for a clear audit
// trail, same as every larger batch this session.
//
// CATEGORY, checked against live Erply, not guessed:
//   - Eraser -> groupID 20 "Erasers" (searchName "eraser" -> 26/26, total
//     precedent, real established category, 30 active products).
//   - Silicon (bag/purse) -> groupID 4 "Bags/Purses" (searchName "silicon"
//     -> 6/17 dominant, and both of this batch's 2 items are literally
//     named "...Silicone Purse"/"...Silicon Bag" -- same established
//     category as Backpack/Coin Purse/Purses).
//   - Slipper/socks -> groupID 2 "Accessories" (searchName "stocking" ->
//     0 results, but "sock" -> 11/13 dominant precedent there; this
//     batch's 2 items are literally named "Stockings", not slippers, so
//     NOT routed to the Slippers category from the Plush batch).
//   - Speakers -> groupID 36 "LED/Electronics" (searchName "speaker" is
//     fragmented across several real categories -- LED/Electronics 15/34,
//     Speaker Cups 9/34, Tumblers 6/34, Lamps 4/34 -- LED/Electronics is
//     the largest bucket and the best fit for a generic standalone
//     Bluetooth-style speaker, as opposed to "Speaker Cups" which are a
//     drinkware sub-type this batch's 2 items don't match).
//   - Battery -> NO live precedent found anywhere (searchName "battery"
//     returns 0 results catalog-wide) -- defaulted to groupID 60 "General
//     Merchandise" (a real, established generic catch-all bucket, though
//     itself currently empty of active products) as the least-wrong
//     option, flagged explicitly as a no-precedent judgment call rather
//     than silently asserted.
//
// NAME reformatting: standard conservative dz-aware pack-spec handling,
// shout-case detection, and one new confirmed typo: "3dzpk" -> "3dz/pk"
// (missing slash, E273211).
//
// Read-only against the source file. Writes a NEW xlsx to
// data/qbd-catalog-compare/remaining-small-categories-final.xlsx.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const SOURCE_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', '805-new-products-review.xlsx')
const OUT_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'remaining-small-categories-final.xlsx')

const KEEP_AS_IS = new Set(['w/', 'w.', 'w', 'of', 'the', 'and', 'a', 'an', 'in', 'on', 'with', 'x'])

function isShoutCase(str) {
  const letters = str.replace(/[^a-zA-Z]/g, '')
  return letters.length > 0 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()
}

function toTitleCase(str) {
  const input = isShoutCase(str) ? str.toLowerCase() : str
  return input
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

function normalizeCaseSuffix(rawName) {
  return rawName.replace(/\bc\s*\/\s*s\b/gi, '/cs')
}
function extractFlatCaseCount(rawName) {
  if (/dz\b/i.test(rawName)) return null
  const m = normalizeCaseSuffix(rawName).match(/(\d+)\s*(?:pcs)?\s*\/\s*(?:cs|case)\b/i)
  return m ? Number(m[1]) : null
}
function stripFlatCaseCount(rawName) {
  return normalizeCaseSuffix(rawName)
    .replace(/\s*-?\s*\d+\s*(?:pcs)?\s*\/\s*(?:cs|case)\b/i, '')
    .replace(/\(\s*\)/g, '')
    .trim()
}

const TYPO_FIXES = [[/(\d+)dzpk\b/gi, '$1dz/pk']] // "3dzpk" -> "3dz/pk" (missing slash)

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

const BATCHES = [
  { sheetName: 'Eraser', group: { id: 20, name: 'Erasers' }, note: null },
  { sheetName: 'Silicon', group: { id: 4, name: 'Bags/Purses' }, note: null },
  { sheetName: 'Slipper-socks', group: { id: 2, name: 'Accessories' }, note: 'Named "Stockings", not "slippers" -- routed to Accessories (11/13 live precedent for "sock"), NOT the Slippers category (groupID 51) from the Plush batch' },
  { sheetName: 'Speakers', group: { id: 36, name: 'LED/Electronics' }, note: 'Generic speaker, not a "Speaker Cup" (drinkware sub-type) -- routed to the largest real bucket for "speaker" (15/34 live precedent)' },
  { sheetName: 'Battery', group: { id: 60, name: 'General Merchandise' }, note: 'NO LIVE PRECEDENT FOUND ANYWHERE -- searchName "battery" returns 0 results catalog-wide. Defaulted to the generic "General Merchandise" catch-all (itself currently empty of active products) as the least-wrong option. Please confirm or redirect to a better category if you know of one.' },
]

function main() {
  const wb = XLSX.readFile(SOURCE_XLSX)
  const wbOut = XLSX.utils.book_new()
  const allRows = []

  for (const { sheetName, group, note } of BATCHES) {
    const sheet = wb.Sheets[sheetName]
    if (!sheet) { console.error(`Sheet "${sheetName}" not found`); continue }
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: null })
    console.log(`\n${sheetName}: ${rows.length} rows -> groupID ${group.id} (${group.name})`)

    let renamed = 0
    const final = rows.map((r) => {
      const original = r.proposed_name
      const { name: newName, hadDzPackInfo } = reformatName(original)
      if (newName !== original) renamed++

      const notes = []
      if (note) notes.push(note)
      if (hadDzPackInfo) notes.push('Pack quantity uses dozen-based notation ("dz") -- left as informational text only, NOT converted to the cart\'s machine-readable pack-spec format (would require an unverified x12 multiply on ambiguous phrasing)')
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
    console.log(`  Renamed: ${renamed} / ${rows.length}`)
    final.filter((r) => r.original_proposed_name !== r.proposed_name).forEach((r) =>
      console.log(`    "${r.original_proposed_name}" -> "${r.proposed_name}"`))

    allRows.push(...final)

    const ws = XLSX.utils.json_to_sheet(final)
    ws['!cols'] = [
      { wch: 14 }, { wch: 20 }, { wch: 16 }, { wch: 22 }, { wch: 55 }, { wch: 18 },
      { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 30 }, { wch: 16 }, { wch: 16 },
      { wch: 55 }, { wch: 50 }, { wch: 14 }, { wch: 18 }, { wch: 65 },
    ]
    ws['!autofilter'] = { ref: ws['!ref'] }
    XLSX.utils.book_append_sheet(wbOut, ws, sheetName.slice(0, 31))
  }

  const allWs = XLSX.utils.json_to_sheet(allRows)
  allWs['!autofilter'] = { ref: allWs['!ref'] }
  XLSX.utils.book_append_sheet(wbOut, allWs, 'All Combined', true)

  fs.mkdirSync(path.dirname(OUT_XLSX), { recursive: true })
  XLSX.writeFile(wbOut, OUT_XLSX)
  console.log(`\nWrote ${path.relative(ROOT, OUT_XLSX)} (${allRows.length} rows total)`)
}

main()
