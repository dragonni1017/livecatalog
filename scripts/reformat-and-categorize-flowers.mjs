// reformat-and-categorize-flowers.mjs
// Run with: node scripts/reformat-and-categorize-flowers.mjs
//
// Same treatment as the earlier batches, for the 15-row Flowers batch
// (data/qbd-catalog-compare/flowers-review-enriched.xlsx).
//
// CATEGORY: unlike every prior batch, this one has no single dominant
// keyword/precedent -- searchName "flower" itself is fragmented across 15+
// real floral-department subcategories (Bows, Papers, Floral Supplies,
// Floral Papers, Floral Baskets, Floral Boxes, Flower Supplies, Wrapping
// Paper, Flower Spray, Crochets, Ribbons -- all real, all with several
// products). Reading the actual 15 rows: 9 of them are "Lace Metallic..."
// items -- a ribbon/trim material, not literal flowers -- and only 6 are
// actual flower-named products.
//
//   - The 9 Lace items -> groupID 47 "Ribbons" (confirmed live: searchName
//     "ribbon" -> 25/50 precedent, real established category added
//     2026-06-03, NOT the near-empty groupID 68 "Ribbon" added
//     2026-09-01, same duplicate-group pattern found repeatedly this
//     session). No dedicated "Lace" category exists; Ribbons is the
//     closest real material-category fit, not a fabricated new bucket.
//   - The other 6 (roses, "In Love Flower", "Flowers Light Up", "Flower
//     Bear" x2, "Flower Lace Necklace") -> groupID 28 "Flowers" (real
//     category, added 2026-06-03). "Flower Bear" and "Flower Lace
//     Necklace" have weak/no direct precedent (a "flower bear" search
//     only returned one unrelated 3D-printed item) -- flagged as
//     lower-confidence judgment calls rather than asserted as certain.
//
// NAME reformatting: standard conservative dz-aware pack-spec handling and
// shout-case detection, no new typo fixes needed for this batch.
//
// Read-only against the source file. Writes a NEW xlsx to
// data/qbd-catalog-compare/flowers-review-final.xlsx.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const SOURCE_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'flowers-review-enriched.xlsx')
const OUT_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'flowers-review-final.xlsx')

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

const FLOWERS_GROUP = { id: 28, name: 'Flowers' }
const RIBBONS_GROUP = { id: 47, name: 'Ribbons' }

const RIBBON_SKUS = new Set([
  'F284938', 'F285142', 'F285244', 'F285550', 'F285652',
  'F285754', 'F285856', 'F285958', 'F286060',
])
const LOW_CONFIDENCE_SKUS = new Set(['F286264', 'T640447', 'F303510'])

function main() {
  const wb = XLSX.readFile(SOURCE_XLSX)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Flowers Review'], { defval: null })
  console.log(`Read ${rows.length} rows`)

  let renamed = 0
  const final = rows.map((r) => {
    const original = r.proposed_name
    const { name: newName, hadDzPackInfo } = reformatName(original)
    if (newName !== original) renamed++

    const isRibbon = RIBBON_SKUS.has(r.proposed_sku)
    const group = isRibbon ? RIBBONS_GROUP : FLOWERS_GROUP

    const notes = []
    if (isRibbon) notes.push('This is a "Lace" (ribbon/trim material) item, not a literal flower -- routed to the real established Ribbons category (25/50 live precedent); no dedicated Lace category exists')
    if (LOW_CONFIDENCE_SKUS.has(r.proposed_sku)) notes.push('LOWER CONFIDENCE: weak/no direct live precedent for this specific sub-type -- defaulted to Flowers based on the product name, please double-check')
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
  console.log('\nCategory assignments:')
  final.forEach((r) => console.log(`  ${r.proposed_sku} -> ${r.category_name}: "${r.proposed_name}"`))

  const ws = XLSX.utils.json_to_sheet(final)
  ws['!cols'] = [
    { wch: 14 }, { wch: 20 }, { wch: 16 }, { wch: 22 }, { wch: 55 }, { wch: 18 },
    { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 30 }, { wch: 16 }, { wch: 16 },
    { wch: 55 }, { wch: 50 }, { wch: 14 }, { wch: 18 }, { wch: 65 },
  ]
  ws['!autofilter'] = { ref: ws['!ref'] }
  const wbOut = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wbOut, ws, 'Flowers Final')
  fs.mkdirSync(path.dirname(OUT_XLSX), { recursive: true })
  XLSX.writeFile(wbOut, OUT_XLSX)
  console.log(`\nWrote ${path.relative(ROOT, OUT_XLSX)}`)
}

main()
