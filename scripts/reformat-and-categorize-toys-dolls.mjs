// reformat-and-categorize-toys-dolls.mjs
// Run with: node scripts/reformat-and-categorize-toys-dolls.mjs
//
// Same treatment as the earlier batches, for the 40-row Toys/Dolls batch
// (data/qbd-catalog-compare/toys-dolls-review-enriched.xlsx).
//
// CATEGORY, checked against live Erply, not guessed:
//   - Generic toys/dolls/play sets -> groupID 56 "Toys" (same real
//     established category confirmed for the Toys/Cars batch; "shopping
//     cart" precedent search: 2/2 existing products use groupID 56).
//   - "Fan" items -> groupID 19 "Fan", a real dedicated category
//     (searchName "fan" -> 28/33 live precedent, added 2026-06-03).
//   - "Lamp" items -> groupID 34 "Lamps", a real dedicated category
//     (searchName "lamp" -> 21/24 live precedent, added 2026-06-03).
//   - T640457 "Elegand Doll Key Chain" -> groupID 33 "Keychains" (same
//     established category as the Keychains/Pens batches) based on the
//     literal product name; no direct "doll key chain" precedent found
//     live, closest real match used instead of inventing a new category.
//   The two "Plush X in Cage" items (T635002, T637216) stay in Toys --
//   they're caged toy/playset items, not stuffed animals for cuddling, so
//   "Plush" here is a material descriptor, not evidence they belong in the
//   Plush Toys category; flagged as a judgment call.
//
// NAME reformatting: same conservative dz-aware pack-spec handling and
// shout-case detection (see reformat-and-categorize-keychains.mjs) as the
// prior batches, plus "Elegand" -> "Elegant" (confirmed typo).
//
// Read-only against the source file. Writes a NEW xlsx to
// data/qbd-catalog-compare/toys-dolls-review-final.xlsx.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const SOURCE_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'toys-dolls-review-enriched.xlsx')
const OUT_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'toys-dolls-review-final.xlsx')

const KEEP_AS_IS = new Set(['w/', 'w', 'of', 'the', 'and', 'a', 'an', 'in', 'on', 'with', 'x'])

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

const TYPO_FIXES = [[/\belegand\b/gi, 'Elegant']]

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

const CATEGORIES = {
  TOYS: { id: 56, name: 'Toys' },
  FAN: { id: 19, name: 'Fan' },
  LAMPS: { id: 34, name: 'Lamps' },
  KEYCHAINS: { id: 33, name: 'Keychains' },
}

function pickCategory(sku, name) {
  if (sku === 'T640457') return { group: CATEGORIES.KEYCHAINS, reason: 'Name literally says "Key Chain" -- routed to the established Keychains category rather than generic Toys; no direct "doll key chain" precedent found live, closest real match used' }
  if (/\bfan\b/i.test(name)) return { group: CATEGORIES.FAN, reason: 'Name mentions "fan" -- real dedicated category (28/33 live precedent), not generic Toys' }
  if (/\blamp\b/i.test(name)) return { group: CATEGORIES.LAMPS, reason: 'Name mentions "lamp" -- real dedicated category (21/24 live precedent), not generic Toys' }
  return { group: CATEGORIES.TOYS, reason: null }
}

function main() {
  const wb = XLSX.readFile(SOURCE_XLSX)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Toys-Dolls Review'], { defval: null })
  console.log(`Read ${rows.length} rows`)

  let renamed = 0
  const categoryTally = new Map()

  const final = rows.map((r) => {
    const original = r.proposed_name
    const { name: newName, hadDzPackInfo } = reformatName(original)
    if (newName !== original) renamed++

    const { group, reason } = pickCategory(r.proposed_sku, original)
    categoryTally.set(group.name, (categoryTally.get(group.name) || 0) + 1)

    const notes = []
    if (reason) notes.push(reason)
    if (r.proposed_sku === 'T635002' || r.proposed_sku === 'T637216') notes.push('JUDGMENT CALL: name mentions "Plush" but this is a caged toy/playset, not a stuffed animal -- kept in Toys, not Plush Toys; confirm if you disagree')
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
  XLSX.utils.book_append_sheet(wbOut, ws, 'Toys-Dolls Final')
  fs.mkdirSync(path.dirname(OUT_XLSX), { recursive: true })
  XLSX.writeFile(wbOut, OUT_XLSX)
  console.log(`\nWrote ${path.relative(ROOT, OUT_XLSX)}`)
}

main()
