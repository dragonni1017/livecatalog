// reformat-squishy-names.mjs
// Run with: node scripts/reformat-squishy-names.mjs
//
// Reformats the 231 QBD-derived Squishy product names (from
// data/qbd-catalog-compare/squishy-review-enriched.xlsx) to match this
// catalog's real naming conventions, learned from the 85 existing "squishy"
// products already live in Supabase (checked directly, not assumed):
//
//   - Title Case throughout (existing catalog: "Adorable Bear Squishy",
//     "Baby Highland Cow Squishy") -- QBD source is often raw lowercase
//     ("unicorn head small size 250pcs/cs").
//   - Both "Squishy X" and "X Squishy" word orders are legitimately used
//     side by side in the real catalog (e.g. "Squishy Dino" vs "Adorable
//     Bear Squishy") -- NOT reordered here, since there's no single rule to
//     enforce.
//   - Pack quantity, when known, is a real trailing spec the catalog's own
//     cart math depends on: "- N/pk Mbx/cs cs.Total" (see lib/pack.ts,
//     extractPackSpec/extractUnitsPerCase -- the "+1 case" button requires
//     this exact shape, "cs.N" alone or "Npcs/cs" glued onto the name does
//     NOT get picked up). Several QBD rows only give a flat case count with
//     no real pack/box breakdown (e.g. "250pcs/cs") -- for those, this
//     follows the same "1/pk Nbx/cs cs.N" convention already used elsewhere
//     in this catalog for single-unit-per-box items (see
//     scripts/create-missing-plush-in-erply.mjs's siblings), rather than
//     inventing a pk/bx split that isn't real.
//   - A short set of confirmed typos/spelling fixes found while reviewing
//     (pumkin -> pumpkin, "squishes"/"Squish X" -> Squishy, stray double
//     spaces, mid-string lowercase like "blue Cake" -> "Blue Cake").
//
// This does NOT touch Supabase or Erply -- read-only against the enriched
// review file, writes a NEW xlsx with the original QBD description and the
// reformatted proposal side by side so every change stays visible and
// reviewable, not silently applied.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

const SOURCE_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'squishy-review-enriched.xlsx')
const OUT_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'squishy-review-reformatted.xlsx')

// Small, confirmed set -- not a general spellchecker. Each was spotted by
// eye while reviewing the actual 231 rows, not guessed.
const TYPO_FIXES = [
  [/\bpumkin\b/gi, 'Pumpkin'],
  [/\bsquishes\b/gi, 'Squishy'],
  [/\bsquish\b/gi, 'Squishy'], // "Squish Owl" -> "Squishy Owl" (missing final "y")
  [/\bmashmello\b/gi, 'Marshmallow'],
]

// Words that should stay lowercase / as-is even in Title Case (abbreviations,
// connectors) -- matches how the existing catalog already writes these
// (e.g. "Adorable Unicorn Squishy w/ Puff Balls" keeps "w/" lowercase).
const KEEP_AS_IS = new Set(['w/', 'w', 'of', 'the', 'and', 'a', 'an', 'in', 'on', 'with'])

// Only ever RAISES a lowercase first letter to uppercase -- never lowers or
// otherwise touches any other character in the word. This is deliberately
// conservative: a naive full title-case (lowercasing everything first,
// then capitalizing) mangles compounds that already carry meaningful
// internal capitalization or codes, e.g. "Blue/Pink Line" -> "Blue/pink
// Line" or "Rainbow-YB-006" -> "Rainbow-yb-006" -- both wrong, found while
// reviewing this script's own first-pass output against the source data.
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
  // "250pcs/cs", "24pcs/cs", "24 pcs/cs", "60/cs" etc -- a flat per-case
  // total with no inner pack/box breakdown given.
  const m = rawName.match(/(\d+)\s*(?:pcs)?\s*\/\s*cs\b/i)
  return m ? Number(m[1]) : null
}

function stripFlatCaseCount(rawName) {
  return rawName.replace(/\s*-?\s*\d+\s*(?:pcs)?\s*\/\s*cs\b/i, '').trim()
}

function reformatName(rawName) {
  let name = String(rawName || '').trim()
  const flatCount = extractFlatCaseCount(name)
  if (flatCount) name = stripFlatCaseCount(name)

  for (const [pattern, replacement] of TYPO_FIXES) {
    name = name.replace(pattern, replacement)
  }

  name = name.replace(/\s{2,}/g, ' ').trim()
  name = toTitleCase(name)

  if (flatCount) {
    name = `${name} - 1/pk ${flatCount}bx/cs cs.${flatCount}`
  }

  return name
}

function main() {
  if (!fs.existsSync(SOURCE_XLSX)) {
    console.error(`Source not found: ${SOURCE_XLSX} -- run deep-review-squishy.mjs first`)
    process.exit(1)
  }
  const wb = XLSX.readFile(SOURCE_XLSX)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['Squishy Review'], { defval: null })
  console.log(`Read ${rows.length} rows`)

  let changed = 0
  const reformatted = rows.map((r) => {
    const original = r.proposed_name
    const newName = reformatName(original)
    if (newName !== original) changed++
    return { ...r, original_proposed_name: original, proposed_name: newName }
  })
  console.log(`Renamed: ${changed} / ${rows.length}`)

  const ws = XLSX.utils.json_to_sheet(reformatted)
  ws['!cols'] = [
    { wch: 14 }, { wch: 20 }, { wch: 16 }, { wch: 22 }, { wch: 55 }, { wch: 18 },
    { wch: 10 }, { wch: 16 }, { wch: 16 }, { wch: 30 }, { wch: 16 }, { wch: 16 },
    { wch: 55 }, { wch: 50 },
  ]
  ws['!autofilter'] = { ref: ws['!ref'] }
  const wbOut = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wbOut, ws, 'Squishy Reformatted')
  XLSX.writeFile(wbOut, OUT_XLSX)
  console.log(`\nWrote ${path.relative(ROOT, OUT_XLSX)}`)

  console.log('\nSample before/after:')
  reformatted.slice(0, 15).forEach((r) =>
    console.log(`  "${r.original_proposed_name}" -> "${r.proposed_name}"`))
}

main()
