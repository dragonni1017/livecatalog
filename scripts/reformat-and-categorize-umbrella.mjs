// reformat-and-categorize-umbrella.mjs
// Run with: node scripts/reformat-and-categorize-umbrella.mjs
//
// Same treatment as the earlier batches, for the 4-row Umbrella batch
// (data/qbd-catalog-compare/umbrella-review-enriched.xlsx).
//
// CATEGORY: groupID 58 "Umbrella" for all 4 -- same real established
// category already confirmed live in the Toys/Cars batch (27/27
// precedent).
//
// NAME reformatting: standard conservative dz-aware pack-spec handling and
// shout-case detection; no new typo fixes needed for this batch. One row
// (T640255) has a "5 inbox/cs" fragment inside a dz-containing string --
// correctly left as informational text only, same conservative rule as
// every other dz-containing row.
//
// Read-only against the source file. Writes a NEW xlsx to
// data/qbd-catalog-compare/umbrella-review-final.xlsx.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const SOURCE_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'umbrella-review-enriched.xlsx')
const OUT_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'umbrella-review-final.xlsx')

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

function reformatName(rawName) {
  let name = String(rawName || '').trim()
  if (!name) return { name, hadDzPackInfo: false }
  const hadDzPackInfo = /dz\b/i.test(name)
  const flatCount = extractFlatCaseCount(name)
  if (flatCount) name = stripFlatCaseCount(name)
  name = name.replace(/\s{2,}/g, ' ').replace(/[\s-]+$/, '').trim()
  name = toTitleCase(name)
  if (flatCount) name = `${name} - 1/pk ${flatCount}bx/cs cs.${flatCount}`
  return { name, hadDzPackInfo }
}

const GROUP = { id: 58, name: 'Umbrella' }

function main() {
  const wb = XLSX.readFile(SOURCE_XLSX)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Umbrella Review'], { defval: null })
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
      category_group_id: GROUP.id,
      category_name: GROUP.name,
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
  XLSX.utils.book_append_sheet(wbOut, ws, 'Umbrella Final')
  fs.mkdirSync(path.dirname(OUT_XLSX), { recursive: true })
  XLSX.writeFile(wbOut, OUT_XLSX)
  console.log(`\nWrote ${path.relative(ROOT, OUT_XLSX)}`)
}

main()
