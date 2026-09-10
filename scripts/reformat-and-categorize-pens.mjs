// reformat-and-categorize-pens.mjs
// Run with: node scripts/reformat-and-categorize-pens.mjs
//
// Same treatment as the earlier batches, for the 52-row Pens batch
// (data/qbd-catalog-compare/pens-review-enriched.xlsx).
//
// CATEGORY: groupID 42 "Pens" for 50 of 52 -- confirmed live (searchName
// "pen" -> 37/50 sampled existing products use this group, 82 active
// products total, added 2026-06-03 -- the real established category, NOT
// the near-empty groupID 73 "pen" lowercase, 6 products, added
// 2026-09-01, same duplicate-group pattern found repeatedly this session).
//
// Two items are QB mis-filings, not pens at all -- "Keychain Phone
// Unicorn"/"Keychain Phone Black Dog" (K227773, K227875): reassigned to
// groupID 33 "Keychains" (the real established keychain category, 150
// products) based on the literal product name and "K" SKU prefix -- no
// direct "keychain phone" precedent found live, but this is the closest
// real match, not a guess at a brand-new category.
//
// NAME reformatting: same conservative dz-aware pack-spec handling as
// Toys/Cars/Slime/Backpack (this batch is ~90% dozen-based pack notation,
// so most rows keep their pack info as text only, not the machine-readable
// cart format) plus "sequence" -> "Sequin" (same recurring vendor typo
// already confirmed and fixed in the Backpack batch).
//
// Read-only against the source file. Writes a NEW xlsx to
// data/qbd-catalog-compare/pens-review-final.xlsx.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const SOURCE_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'pens-review-enriched.xlsx')
const OUT_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'pens-review-final.xlsx')

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
    // A flat count that lived inside parens (e.g. "(720/cs)") leaves an
    // orphaned empty "()" behind once its digits are stripped -- found on
    // Pens SKU P256955 ("... 20bx/cs (720/cs)" -> "... 20bx/cs ()").
    // Clean up the empty shell too, not just the digits.
    .replace(/\(\s*\)/g, '')
    .trim()
}

const TYPO_FIXES = [
  [/\bsequence\b/gi, 'Sequin'],
  [/^pen\s*:\s*/i, 'Pen '],
  [/^pens\s*:\s*/i, 'Pens '],
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

const PEN_GROUP = { id: 42, name: 'Pens' }
const KEYCHAIN_GROUP = { id: 33, name: 'Keychains' }
const KEYCHAIN_SKUS = new Set(['K227773', 'K227875'])

function main() {
  const wb = XLSX.readFile(SOURCE_XLSX)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Pens Review'], { defval: null })
  console.log(`Read ${rows.length} rows`)

  let renamed = 0
  const final = rows.map((r) => {
    const original = r.proposed_name
    const { name: newName, hadDzPackInfo } = reformatName(original)
    if (newName !== original) renamed++

    const isKeychain = KEYCHAIN_SKUS.has(r.proposed_sku)
    const group = isKeychain ? KEYCHAIN_GROUP : PEN_GROUP

    const notes = []
    if (isKeychain) notes.push('Not actually a pen -- QB mis-filed this under the "Pens" parent item. Reassigned to groupID 33 "Keychains" (real established category) based on the product name and "K" SKU prefix; no direct live precedent for this exact sub-type found, closest real match used instead of inventing a new category')
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
  console.log('\nReassigned off default Pens:')
  final.filter((r) => r.category_name !== 'Pens').forEach((r) =>
    console.log(`  ${r.proposed_sku} -> ${r.category_name}: "${r.proposed_name}"`))
  console.log('\nSample renames:')
  final.filter((r) => r.original_proposed_name !== r.proposed_name).slice(0, 15).forEach((r) =>
    console.log(`  "${r.original_proposed_name}" -> "${r.proposed_name}"`))

  const ws = XLSX.utils.json_to_sheet(final)
  ws['!cols'] = [
    { wch: 14 }, { wch: 20 }, { wch: 16 }, { wch: 22 }, { wch: 55 }, { wch: 18 },
    { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 30 }, { wch: 16 }, { wch: 16 },
    { wch: 55 }, { wch: 50 }, { wch: 14 }, { wch: 18 }, { wch: 65 },
  ]
  ws['!autofilter'] = { ref: ws['!ref'] }
  const wbOut = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wbOut, ws, 'Pens Final')
  fs.mkdirSync(path.dirname(OUT_XLSX), { recursive: true })
  XLSX.writeFile(wbOut, OUT_XLSX)
  console.log(`\nWrote ${path.relative(ROOT, OUT_XLSX)}`)
}

main()
