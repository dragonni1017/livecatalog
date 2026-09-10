// reformat-and-categorize-plush.mjs
// Run with: node scripts/reformat-and-categorize-plush.mjs
//
// Same two-pass treatment as the Squishy batch (reformat-squishy-names.mjs
// + assign-squishy-categories.mjs), combined into one script for Plush's
// 79 rows (data/qbd-catalog-compare/plush-review-enriched.xlsx):
//
// 1. Name reformatting -- Title Case (only ever raises an already-lowercase
//    first letter, never touches an already-uppercase character -- see
//    reformat-squishy-names.mjs's header for why a naive full title-case is
//    wrong), a bare "Npcs/cs" / "N/cs" flat case count converted to the
//    catalog's real pack-spec suffix "- 1/pk Nbx/cs cs.N" (lib/pack.ts),
//    and "Lama" -> "Llama" (same recurring vendor typo pattern already
//    fixed for Squishy, no existing catalog/Erply precedent either way but
//    it's an obvious misspelling).
//
// 2. Category assignment -- checked against LIVE Erply, not assumed:
//    - Genuine plush stuffed animals -> groupID 46 "Plush Toys" (confirmed
//      live: 18/20 sampled existing plush products use this).
//    - Slippers are their OWN established category, not generic Plush --
//      groupID 51 "Slippers" (confirmed live: 19/20 sampled existing
//      slipper products use this, completely separate from 46). Caught via
//      a broad case-insensitive "slipper" substring match, NOT the
//      deep-review-category.mjs script's \bslipper\b word-boundary regex --
//      that one misses the plural "Slippers" (no word boundary between
//      "slipper" and the trailing "s"), which undercounted this batch's
//      real slipper items (16 found vs the real 20).
//    - "Pillow" items have ZERO existing precedent anywhere -- checked
//      both Supabase and live Erply (searchName=pillow), 0 results either
//      place. No dedicated category exists to route them to, so they stay
//      in the default Plush Toys bucket rather than inventing one.
//    - One item, P272415, has a null/blank name in the QBD source --
//      flagged, not renamable or categorizable from nothing.
//
// Read-only against the source file. Writes a NEW xlsx to
// data/qbd-catalog-compare/plush-review-final.xlsx.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const SOURCE_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'plush-review-enriched.xlsx')
const OUT_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'plush-review-final.xlsx')

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
  const m = rawName.match(/(\d+)\s*(?:pcs)?\s*\/\s*(?:cs|case)\b/i)
  return m ? Number(m[1]) : null
}
function stripFlatCaseCount(rawName) {
  return rawName.replace(/\s*x?\s*-?\s*\d+\s*(?:pcs)?\s*\/\s*(?:cs|case)\b/i, '').trim()
}

const TYPO_FIXES = [[/\blama\b/gi, 'Llama']]

function reformatName(rawName) {
  let name = String(rawName || '').trim()
  if (!name) return name
  const flatCount = extractFlatCaseCount(name)
  if (flatCount) name = stripFlatCaseCount(name)
  for (const [pattern, replacement] of TYPO_FIXES) name = name.replace(pattern, replacement)
  name = name.replace(/\s{2,}/g, ' ').trim()
  name = toTitleCase(name)
  if (flatCount) name = `${name} - 1/pk ${flatCount}bx/cs cs.${flatCount}`
  return name
}

const SLIPPER_GROUP = { id: 51, name: 'Slippers' }
const PLUSH_GROUP = { id: 46, name: 'Plush Toys' }

function main() {
  const wb = XLSX.readFile(SOURCE_XLSX)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Plush Review'], { defval: null })
  console.log(`Read ${rows.length} rows`)

  let renamed = 0
  let slipperCount = 0
  let blankCount = 0

  const final = rows.map((r) => {
    const original = r.proposed_name
    const isBlank = !original || !String(original).trim()
    const isSlipper = !isBlank && /slipper/i.test(original)

    if (isBlank) blankCount++
    if (isSlipper) slipperCount++

    const newName = isBlank ? original : reformatName(original)
    if (newName !== original) renamed++

    const group = isSlipper ? SLIPPER_GROUP : PLUSH_GROUP
    const notes = []
    if (isBlank) notes.push('BLANK NAME IN QBD SOURCE -- cannot reformat or categorize from nothing, needs a real name before this can be created')
    if (isSlipper) notes.push('Reassigned to groupID 51 "Slippers" (real, established category, 19/20 sampled existing slippers) -- NOT generic Plush Toys')
    if (!isBlank && !isSlipper && /pillow/i.test(original)) notes.push('No existing "Pillow" category found anywhere (checked Supabase + live Erply, 0 results) -- left in default Plush Toys, no dedicated category exists to route this to')
    if (r.proposed_sku === 'P221705') notes.push('JUDGMENT CALL: name also mentions "Squishy" ("Plush Panda Squishy Face Pillow") -- kept in Plush Toys since "Plush" is the primary/leading word, confirm if you disagree')
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
  console.log(`Slippers reassigned off default Plush Toys: ${slipperCount}`)
  console.log(`Blank names (unfixable): ${blankCount}`)

  console.log('\nSample renames:')
  final.filter((r) => r.original_proposed_name !== r.proposed_name).slice(0, 15).forEach((r) =>
    console.log(`  "${r.original_proposed_name}" -> "${r.proposed_name}"`))

  console.log('\nAll slipper reassignments:')
  final.filter((r) => r.category_group_id === 51).forEach((r) =>
    console.log(`  ${r.proposed_sku}: "${r.proposed_name}"`))

  const ws = XLSX.utils.json_to_sheet(final)
  ws['!cols'] = [
    { wch: 14 }, { wch: 20 }, { wch: 16 }, { wch: 22 }, { wch: 55 }, { wch: 18 },
    { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 30 }, { wch: 16 }, { wch: 16 },
    { wch: 55 }, { wch: 50 }, { wch: 14 }, { wch: 18 }, { wch: 65 },
  ]
  ws['!autofilter'] = { ref: ws['!ref'] }
  const wbOut = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wbOut, ws, 'Plush Final')
  fs.mkdirSync(path.dirname(OUT_XLSX), { recursive: true })
  XLSX.writeFile(wbOut, OUT_XLSX)
  console.log(`\nWrote ${path.relative(ROOT, OUT_XLSX)}`)
}

main()
