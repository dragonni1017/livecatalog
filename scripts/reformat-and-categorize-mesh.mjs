// reformat-and-categorize-mesh.mjs
// Run with: node scripts/reformat-and-categorize-mesh.mjs
//
// Same treatment as the earlier batches, for the 27-row Mesh Ball batch
// (data/qbd-catalog-compare/mesh-review-enriched.xlsx).
//
// CATEGORY: groupID 52 "Squishy / Slime" for all 27 -- confirmed live
// (searchName "mesh ball" -> 3/3 existing products use this group). This
// whole QB category maps onto the same real established category already
// confirmed for Squishy/Slime/Squeeze-Ball items in earlier batches, not a
// separate "Mesh Ball" category -- no reassignments needed within this
// batch, every row (including the flagged "Squeeze ball"/"Magic Slime"
// items) already belongs in Squishy/Slime.
//
// NAME reformatting: same conservative dz-aware pack-spec handling and
// shout-case detection as prior batches, plus the same "dx" -> "dz" typo
// fix already confirmed in the Slime batch (this batch reuses it heavily:
// M131113, M132325, M132333).
//
// One row (M132322) has a blank name in the QBD source -- flagged, not
// renamable or categorizable from nothing.
//
// Read-only against the source file. Writes a NEW xlsx to
// data/qbd-catalog-compare/mesh-review-final.xlsx.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const SOURCE_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'mesh-review-enriched.xlsx')
const OUT_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'mesh-review-final.xlsx')

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

const TYPO_FIXES = [[/(\d+)dx\b/gi, '$1dz']] // "1dx/bx", "12dx/cs" -> "dz" (same confirmed typo as the Slime batch)

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

const MESH_GROUP = { id: 52, name: 'Squishy / Slime' }

function main() {
  const wb = XLSX.readFile(SOURCE_XLSX)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Mesh Review'], { defval: null })
  console.log(`Read ${rows.length} rows`)

  let renamed = 0
  let blankCount = 0
  const final = rows.map((r) => {
    const original = r.proposed_name
    const isBlank = !original || !String(original).trim()
    if (isBlank) blankCount++
    const { name: newName, hadDzPackInfo } = isBlank ? { name: original, hadDzPackInfo: false } : reformatName(original)
    if (newName !== original) renamed++

    const notes = []
    if (isBlank) notes.push('BLANK NAME IN QBD SOURCE -- cannot reformat or categorize from nothing, needs a real name before this can be created')
    if (hadDzPackInfo) notes.push('Pack quantity uses dozen-based notation ("dz") -- left as informational text only, NOT converted to the cart\'s machine-readable pack-spec format (would require an unverified x12 multiply on ambiguous phrasing)')
    if (!r.qb_price) notes.push('NO PRICE from QB')

    return {
      ...r,
      original_proposed_name: original,
      proposed_name: newName,
      category_group_id: MESH_GROUP.id,
      category_name: MESH_GROUP.name,
      category_notes: notes.join(' | '),
    }
  })

  console.log(`Renamed: ${renamed} / ${rows.length}`)
  console.log(`Blank names: ${blankCount}`)
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
  XLSX.utils.book_append_sheet(wbOut, ws, 'Mesh Final')
  fs.mkdirSync(path.dirname(OUT_XLSX), { recursive: true })
  XLSX.writeFile(wbOut, OUT_XLSX)
  console.log(`\nWrote ${path.relative(ROOT, OUT_XLSX)}`)
}

main()
