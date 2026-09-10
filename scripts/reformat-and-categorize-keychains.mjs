// reformat-and-categorize-keychains.mjs
// Run with: node scripts/reformat-and-categorize-keychains.mjs
//
// Same treatment as the earlier batches, for the 51-row Keychains batch
// (data/qbd-catalog-compare/keychains-review-enriched.xlsx).
//
// CATEGORY: groupID 33 "Keychains" for 50 of 51 -- the real established
// category confirmed earlier this session (150 active products,
// 2026-06-03). One item, HKHB103 "HK Cat Hair Band", is not a keychain at
// all -- reassigned to groupID 31 "Hair Bands" (confirmed live: both
// "hair band" and "headband" searches point here, 2026-06-03, real
// category). The plush/squishy keychain hybrids (K228895, K228897,
// S128727) stay in Keychains -- same "primary stated nature wins"
// judgment already applied in the Squishy and Pens batches.
//
// NAME reformatting adds a new fix this batch needed: a genuinely
// ALL-CAPS source name (e.g. "SOCCER KEYCHAIN", "KEYCHAIN MIRROR DONUT")
// would survive completely untouched under the conservative "only ever
// raise an already-lowercase first letter" rule used since the Squishy
// batch -- that rule exists to protect real mixed-case codes like
// "Rainbow-YB-006", but an entirely-uppercase phrase has no such code to
// protect and is just shout-typing. Detected via isShoutCase() (a string
// with letters where every letter is already uppercase) and lowercased
// before the normal per-word title-case pass, so it comes out correctly
// as "Soccer Keychain" instead of staying "SOCCER KEYCHAIN".
//
// Also fixes this batch's recurring keychain abbreviations -- "K.C",
// "Kei chain", "Key chain" all mean "Keychain" -- and "1d/pk" -> "1dz/pk"
// (single confirmed typo, K223222).
//
// Read-only against the source file. Writes a NEW xlsx to
// data/qbd-catalog-compare/keychains-review-final.xlsx.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const SOURCE_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'keychains-review-enriched.xlsx')
const OUT_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'keychains-review-final.xlsx')

const KEEP_AS_IS = new Set(['w/', 'w', 'of', 'the', 'and', 'a', 'an', 'in', 'on', 'with', 'x', 'or'])

// True when the string has at least one letter and every letter in it is
// already uppercase -- i.e. shout-typing, not a deliberate mixed-case code.
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

const TYPO_FIXES = [
  [/\bk\.c\.?\b/gi, 'Keychain'],
  [/\bkei\s+chain\b/gi, 'Keychain'],
  // \s+ (real whitespace required), NOT \s* -- \s* would also match the
  // already-correct single word "keychain"/"KEYCHAIN" (zero spaces is a
  // valid match for \s*), rewriting its casing to "Keychain" before the
  // shout-case detector below ever saw it. That silently defeated
  // isShoutCase() for "SOCCER KEYCHAIN" -- by the time toTitleCase() ran,
  // the string was already mixed-case ("SOCCER Keychain"), so it no longer
  // looked like pure shout-typing and the "SOCCER" half was left
  // untouched. Found by testing isShoutCase() directly against the
  // reported bug and confirming the function itself was correct.
  [/\bkey\s+chain\b/gi, 'Keychain'],
  [/\b1d\/pk\b/gi, '1dz/pk'],
  [/\bkeychains(\d)/gi, 'Keychains $1'], // "keychains50dz/cs" -> "keychains 50dz/cs" (missing space)
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

const KEYCHAIN_GROUP = { id: 33, name: 'Keychains' }
const HAIRBAND_GROUP = { id: 31, name: 'Hair Bands' }
const HAIRBAND_SKUS = new Set(['HKHB103'])

function main() {
  const wb = XLSX.readFile(SOURCE_XLSX)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Keychains Review'], { defval: null })
  console.log(`Read ${rows.length} rows`)

  let renamed = 0
  const final = rows.map((r) => {
    const original = r.proposed_name
    const { name: newName, hadDzPackInfo } = reformatName(original)
    if (newName !== original) renamed++

    const isHairband = HAIRBAND_SKUS.has(r.proposed_sku)
    const group = isHairband ? HAIRBAND_GROUP : KEYCHAIN_GROUP

    const notes = []
    if (isHairband) notes.push('Not a keychain -- QB mis-filed this under the "Keychains" parent item. Reassigned to groupID 31 "Hair Bands" (confirmed live: both "hair band" and "headband" searches point here, real established category)')
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
  console.log('\nReassigned off default Keychains:')
  final.filter((r) => r.category_name !== 'Keychains').forEach((r) =>
    console.log(`  ${r.proposed_sku} -> ${r.category_name}: "${r.proposed_name}"`))
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
  XLSX.utils.book_append_sheet(wbOut, ws, 'Keychains Final')
  fs.mkdirSync(path.dirname(OUT_XLSX), { recursive: true })
  XLSX.writeFile(wbOut, OUT_XLSX)
  console.log(`\nWrote ${path.relative(ROOT, OUT_XLSX)}`)
}

main()
