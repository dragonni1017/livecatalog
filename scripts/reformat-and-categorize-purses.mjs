// reformat-and-categorize-purses.mjs
// Run with: node scripts/reformat-and-categorize-purses.mjs
//
// Same treatment as the earlier batches, for the 6-row Purses batch
// (data/qbd-catalog-compare/purses-review-enriched.xlsx).
//
// CATEGORY: groupID 4 "Bags/Purses" for all 6 -- same real established
// category already confirmed live for the Backpack and Coin Purse
// batches; "Purses" is the same category by definition, no separate
// precedent check needed.
//
// NAME reformatting reuses the confirmed "sequence" -> "Sequin" typo fix
// and colon-prefix cleanup from earlier batches, plus a new general fix:
// P281920's OWN SKU was found literally embedded inside its own
// description ("Purse: RoundP281920Sequence Unicorn 48pcs c/s" -- the SKU
// "P281920" typed directly into the name field, a data-entry artifact).
// Rather than a one-off hardcoded fix, this strips any row's own SKU if it
// appears as a substring inside that row's own name, so the same pattern
// gets caught automatically if it recurs in a later batch.
//
// Read-only against the source file. Writes a NEW xlsx to
// data/qbd-catalog-compare/purses-review-final.xlsx.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const SOURCE_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'purses-review-enriched.xlsx')
const OUT_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'purses-review-final.xlsx')

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

function stripEmbeddedSku(name, sku) {
  if (!sku || sku.length < 4) return { name, stripped: false }
  const idx = name.indexOf(sku)
  if (idx === -1) return { name, stripped: false }
  // Join with a single space, not a direct concat -- the SKU can sit glued
  // between two real words with no surrounding whitespace at all (e.g.
  // "RoundP281920Sequence"), and concatenating the halves directly would
  // fuse them into one unbroken word ("RoundSequence"), which also then
  // defeats any later \b-based typo-fix regex (no word boundary exists
  // inside a fused word). The \s{2,} collapse later in the pipeline
  // absorbs the case where real whitespace already existed on one side.
  const cleaned = (name.slice(0, idx) + ' ' + name.slice(idx + sku.length)).replace(/\s{2,}/g, ' ').trim()
  return { name: cleaned, stripped: true }
}

const TYPO_FIXES = [
  [/\bsequence\b/gi, 'Sequin'],
  [/^purse\s*:\s*/i, 'Purse '],
]

function reformatName(rawName, sku) {
  let name = String(rawName || '').trim()
  if (!name) return { name, hadDzPackInfo: false, hadEmbeddedSku: false }
  const embedded = stripEmbeddedSku(name, sku)
  name = embedded.name
  for (const [pattern, replacement] of TYPO_FIXES) name = name.replace(pattern, replacement)
  const hadDzPackInfo = /dz\b/i.test(name)
  const flatCount = extractFlatCaseCount(name)
  if (flatCount) name = stripFlatCaseCount(name)
  name = name.replace(/\s{2,}/g, ' ').replace(/[\s-]+$/, '').trim()
  name = toTitleCase(name)
  if (flatCount) name = `${name} - 1/pk ${flatCount}bx/cs cs.${flatCount}`
  return { name, hadDzPackInfo, hadEmbeddedSku: embedded.stripped }
}

const GROUP = { id: 4, name: 'Bags/Purses' }

function main() {
  const wb = XLSX.readFile(SOURCE_XLSX)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Purses Review'], { defval: null })
  console.log(`Read ${rows.length} rows`)

  let renamed = 0
  const final = rows.map((r) => {
    const original = r.proposed_name
    const { name: newName, hadDzPackInfo, hadEmbeddedSku } = reformatName(original, r.proposed_sku)
    if (newName !== original) renamed++

    const notes = []
    if (hadEmbeddedSku) notes.push(`Row's own SKU ("${r.proposed_sku}") was found typed literally inside the QBD description -- stripped as a data-entry artifact`)
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
  XLSX.utils.book_append_sheet(wbOut, ws, 'Purses Final')
  fs.mkdirSync(path.dirname(OUT_XLSX), { recursive: true })
  XLSX.writeFile(wbOut, OUT_XLSX)
  console.log(`\nWrote ${path.relative(ROOT, OUT_XLSX)}`)
}

main()
