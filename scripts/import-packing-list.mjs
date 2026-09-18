// import-packing-list.mjs
// Run with: node scripts/import-packing-list.mjs --file="<path to supplier xls/xlsx>"          (dry run)
//           node scripts/import-packing-list.mjs --file="<path>" --apply
//           node scripts/import-packing-list.mjs --file="<path>" --apply --by="you@ly-usa.com"
//
// Reads a supplier "Original List" / packing-list spreadsheet (the kind
// that comes in with each shipment container, e.g. the OneDrive "import
// documents" folder) and writes its per-line-item carton dimensions and
// weight to Supabase, the same target columns as
// import-measurement-worklist.mjs.
//
// Confirmed against a real file 2026-09-14 (container EMCU8402359, "Round"):
// the sheet has a 货号 column that IS the Erply/Supabase SKU verbatim
// (format F######), plus a UPC column matching products.barcode exactly.
// Column layout otherwise varies by supplier, so columns are found BY
// HEADER TEXT, not position -- see COLUMN below.
//
// UNIT DETECTION IS FROM THE HEADER TEXT, not assumed. The sample had
// "长cm(外箱)" / "毛重KG（每包装箱）" -- explicit cm and KG -- so this only
// converts when the header itself names a unit ('cm' or a bare '(m)' for
// dimensions; 'kg' or 'lb' for weight). A header with no unit in it is a
// hard error, not a guess -- unlike the hand-filled worklist, a supplier
// sheet's headers are load-bearing and worth trusting, but not extrapolating
// past.
//
// measurements_source is set to 'manual', the only schema value available
// (migration 0045 only allows erply/woo/manual) that gets the "never
// overwritten by the Erply/Woo backfill" precedence this data deserves --
// it's a real supplier document, not a guess. Provenance is kept in
// measurements_updated_by instead: 'packing-list:<container/file name>'.
//
// UPC cross-check: if the sheet's UPC value doesn't match products.barcode
// for the matched SKU, the row is REJECTED, not written -- this business has
// real barcode-collision history (see docs/memory), so a mismatch is a
// signal the SKU mapping is wrong, not noise to override.
//
// THE PARSING RULES NOW HAVE A CANONICAL COPY IN lib/packing-list.ts, used by
// the /admin/receiving screen (migration 0048). This script is kept as a
// mirror because a .mjs can't import TypeScript. One deliberate difference:
// the lib locates dimension columns by name alone ('长') and then REQUIRES a
// unit in that header, while COLUMN below matches ['长', 'cm'] -- so an
// inch-labelled sheet errors here but parses there. Port fixes to the lib
// first; it has test coverage in tests/packing-list.test.ts, including the
// real EMCU8402359 container this script was validated against.
//
// CANONICAL VERSION OF THE PLAUSIBILITY RULE LIVES IN lib/measurements.ts
// (implausibleCaseMeasurement). This is a fourth mirror, because .mjs can't
// import TypeScript -- same constraint noted in that file and in
// build-measurement-worklist.mjs / import-measurement-worklist.mjs. Change
// one, change all four.
//
// Writes to Supabase ONLY -- nothing is pushed to Erply or WooCommerce.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })

const APPLY = process.argv.includes('--apply')
const fileArg = process.argv.find((a) => a.startsWith('--file='))?.slice('--file='.length)
const byArg = process.argv.find((a) => a.startsWith('--by='))?.slice('--by='.length)

if (!fileArg) {
  console.error('Usage: node scripts/import-packing-list.mjs --file="<path to xls/xlsx>" [--apply] [--by=you@ly-usa.com]')
  process.exit(1)
}
const INPUT = path.resolve(fileArg)
if (!fs.existsSync(INPUT)) {
  console.error(`No such file: ${INPUT}`)
  process.exit(1)
}
const SOURCE_TAG = byArg ?? `packing-list:${path.basename(INPUT)}`

const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing in .env.local: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// Header text -> field, matched by "contains all of these substrings"
// rather than an exact string, so punctuation/spacing drift across
// shipments (fullwidth vs halfwidth parens, extra spaces) doesn't break it.
const COLUMN = {
  sku: ['货号'],
  upc: ['UPC'],
  lengthDim: ['长', 'cm'],
  widthDim: ['宽', 'cm'],
  heightDim: ['高', 'cm'],
  // 毛重 (gross weight) + 每包装箱 (per package/carton) distinguishes this
  // from 总量KG (total quantity in kg, summed across all cartons in the line).
  weight: ['毛重'],
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i] ?? []
    if (row.some((cell) => typeof cell === 'string' && cell.includes('货号'))) return i
  }
  return -1
}

function findCol(headerRow, substrings) {
  for (let i = 0; i < headerRow.length; i++) {
    const cell = headerRow[i]
    if (typeof cell !== 'string') continue
    if (substrings.every((s) => cell.includes(s))) return i
  }
  return -1
}

function findAllCols(headerRow, substrings) {
  const hits = []
  for (let i = 0; i < headerRow.length; i++) {
    const cell = headerRow[i]
    if (typeof cell !== 'string') continue
    if (substrings.every((s) => cell.includes(s))) hits.push(i)
  }
  return hits
}

// 外箱 = "outer carton" -- what separates the carton's dimensions from the
// PRODUCT's. Mirrors findDimensionCol in lib/packing-list.ts; see that
// docblock for the full story.
//
// The 2026 supplier format heads its product-spec column
// 产品规格尺寸长*宽*高（CM）, a single cell containing 长, 宽, 高 AND "cm", to
// the LEFT of the real 长cm(外箱) columns. So ['长','cm'] matched the spec
// column and all three axes collapsed onto it, yielding either null cartons
// (the cell is text like "57*57CM") or a bogus L=W=H cube (a bare number).
// Returns -1 when it can't tell, so the caller errors loudly.
const CARTON_MARKER = '外箱'
function findDimensionCol(headerRow, substrings) {
  const candidates = findAllCols(headerRow, substrings)
  if (candidates.length <= 1) return candidates.length === 1 ? candidates[0] : -1
  const carton = candidates.filter((i) => String(headerRow[i]).includes(CARTON_MARKER))
  return carton.length === 1 ? carton[0] : -1
}

const DIMENSION_FIELDS = new Set(['lengthDim', 'widthDim', 'heightDim'])

// Unit is read off the header text itself, never assumed. Returns the
// factor to multiply by to get inches/pounds, or an error if the header
// doesn't name a unit this script recognises.
function dimensionFactor(header) {
  const h = header.toLowerCase()
  if (h.includes('cm')) return { factor: 1 / 2.54, unit: 'cm' }
  if (h.includes('(m)') || /\bm\)/.test(h)) return { factor: 39.3700787, unit: 'm' }
  if (h.includes('in')) return { factor: 1, unit: 'in' }
  return { error: `can't tell what unit "${header}" is in` }
}

function weightFactor(header) {
  const h = header.toLowerCase()
  if (h.includes('kg')) return { factor: 2.20462262, unit: 'kg' }
  if (h.includes('lb')) return { factor: 1, unit: 'lb' }
  return { error: `can't tell what unit "${header}" is in` }
}

// Mirror of lib/measurements.ts implausibleCaseMeasurement -- see file
// header note. Keep bounds identical across all four copies.
const LEAD_LB_PER_IN3 = 0.41
const MAX_WEIGHT_LB = 250
const MAX_DIMENSION_IN = 120
const MIN_DIMENSION_IN = 1

function implausible(v) {
  const dims = [v.case_length_in, v.case_width_in, v.case_height_in]

  const tiny = dims.filter((d) => d != null && d < MIN_DIMENSION_IN)
  if (tiny.length > 0) return `dimension under ${MIN_DIMENSION_IN} inch (${tiny.join(', ')})`

  const huge = dims.filter((d) => d != null && d > MAX_DIMENSION_IN)
  if (huge.length > 0) return `dimension over ${MAX_DIMENSION_IN} in (${huge.join(', ')}) -- extra digit?`

  if (v.case_weight_lb != null && v.case_weight_lb > MAX_WEIGHT_LB) {
    return `weight over ${MAX_WEIGHT_LB} lb (${v.case_weight_lb}) -- entered in grams?`
  }

  if (dims.every((d) => d != null) && v.case_weight_lb != null) {
    const density = v.case_weight_lb / (dims[0] * dims[1] * dims[2])
    if (density > LEAD_LB_PER_IN3) {
      return `impossible density (${density.toFixed(2)} lb/in3, denser than lead)`
    }
  }
  return null
}

const round2 = (n) => Math.round(n * 100) / 100

// Barcodes have a documented leading-zero gap in this project (see
// docs/memory/reference-barcode-backfill-handoff.md) -- compare digits only,
// with leading zeros stripped, rather than exact string equality.
// Digits only, leading zeros stripped -- mirrors normalizeBarcode in
// lib/packing-list.ts. Every non-digit is dropped, not just the surrounding
// whitespace: supplier sheets type UPCs with spaces inside them
// (EGSU1396926 ships T641449 as "6  8140239892 8"), which is the same
// barcode as the stored 681402398928.
const normalizeBarcode = (v) => String(v ?? '').replace(/\D/g, '').replace(/^0+/, '')

async function fetchCatalog(skus) {
  const bySku = new Map()
  for (let i = 0; i < skus.length; i += 200) {
    const chunk = skus.slice(i, i + 200)
    const { data, error } = await supabase
      .from('products')
      .select('id, sku, barcode, case_length_in, case_width_in, case_height_in, case_weight_lb, measurements_source')
      .in('sku', chunk)
    if (error) throw error
    for (const row of data) bySku.set(row.sku, row)
  }
  return bySku
}

async function main() {
  const wb = XLSX.readFile(INPUT)
  let headerRowIndex = -1
  let sheetRows = null
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null })
    const idx = findHeaderRow(rows)
    if (idx >= 0) { headerRowIndex = idx; sheetRows = rows; break }
  }
  if (!sheetRows) {
    console.error('No sheet with a 货号 column found -- this file may not be a packing list this script understands.')
    process.exit(1)
  }

  const headerRow = sheetRows[headerRowIndex]
  const colIndex = {}
  for (const [field, substrings] of Object.entries(COLUMN)) {
    const isDim = DIMENSION_FIELDS.has(field)
    const idx = isDim ? findDimensionCol(headerRow, substrings) : findCol(headerRow, substrings)
    if (idx < 0) {
      const matches = findAllCols(headerRow, substrings)
      const why =
        isDim && matches.length > 1
          ? `${matches.length} headers match and ${matches.filter((i) => String(headerRow[i]).includes(CARTON_MARKER)).length} say ${CARTON_MARKER} (outer carton), so the carton column can't be told from the product one: ${matches.map((i) => `col ${i} ${JSON.stringify(headerRow[i])}`).join(', ')}`
          : `looking for ${substrings.join(' + ')}`
      console.error(`Could not find a column for ${field} (${why}) in the header row: ${JSON.stringify(headerRow)}`)
      process.exit(1)
    }
    colIndex[field] = idx
  }

  const lenUnit = dimensionFactor(headerRow[colIndex.lengthDim])
  const widUnit = dimensionFactor(headerRow[colIndex.widthDim])
  const hgtUnit = dimensionFactor(headerRow[colIndex.heightDim])
  const wgtUnit = weightFactor(headerRow[colIndex.weight])
  for (const u of [lenUnit, widUnit, hgtUnit, wgtUnit]) {
    if (u.error) { console.error(u.error); process.exit(1) }
  }
  console.log(`Units detected from headers: dims in ${lenUnit.unit}/${widUnit.unit}/${hgtUnit.unit}, weight in ${wgtUnit.unit}.\n`)

  const dataRows = sheetRows.slice(headerRowIndex + 1).filter((r) => r && r[colIndex.sku])
  const skus = [...new Set(dataRows.map((r) => String(r[colIndex.sku]).trim()))]
  const catalog = await fetchCatalog(skus)

  const updates = []
  const problems = []
  const stats = { unchanged: 0 }

  for (const row of dataRows) {
    const sku = String(row[colIndex.sku]).trim()
    const where = `SKU ${sku}`

    const product = catalog.get(sku)
    if (!product) { problems.push({ where, problem: 'SKU not found in Supabase' }); continue }

    const rawUpc = row[colIndex.upc]
    if (rawUpc != null && product.barcode != null) {
      const sheetUpc = normalizeBarcode(rawUpc)
      const dbBarcode = normalizeBarcode(product.barcode)
      if (sheetUpc && dbBarcode && sheetUpc !== dbBarcode) {
        problems.push({ where, problem: `UPC mismatch: sheet has ${rawUpc}, Supabase has ${product.barcode} -- SKU mapping may be wrong` })
        continue
      }
    }

    const rawLen = row[colIndex.lengthDim]
    const rawWid = row[colIndex.widthDim]
    const rawHgt = row[colIndex.heightDim]
    const rawWgt = row[colIndex.weight]
    if ([rawLen, rawWid, rawHgt, rawWgt].some((v) => v == null || v === '')) {
      problems.push({ where, problem: 'missing a dimension or weight value' })
      continue
    }
    if ([rawLen, rawWid, rawHgt, rawWgt].some((v) => typeof v !== 'number')) {
      problems.push({ where, problem: `non-numeric dimension/weight (${JSON.stringify([rawLen, rawWid, rawHgt, rawWgt])})` })
      continue
    }

    const next = {
      case_length_in: round2(rawLen * lenUnit.factor),
      case_width_in: round2(rawWid * widUnit.factor),
      case_height_in: round2(rawHgt * hgtUnit.factor),
      case_weight_lb: round2(rawWgt * wgtUnit.factor),
    }

    const reason = implausible(next)
    if (reason) { problems.push({ where, problem: reason }); continue }

    const same = (a, b) => Math.abs((a == null ? NaN : Number(a)) - b) < 0.05
    const changed = ['case_length_in', 'case_width_in', 'case_height_in', 'case_weight_lb']
      .filter((f) => !same(product[f], next[f]))
    if (changed.length === 0) { stats.unchanged++; continue }

    updates.push({
      id: product.id,
      sku,
      fields: {
        ...next,
        measurements_source: 'manual',
        measurements_updated_at: new Date().toISOString(),
        measurements_updated_by: SOURCE_TAG,
      },
      changed,
      wasSource: product.measurements_source,
    })
  }

  console.table([
    { outcome: 'to write', count: updates.length },
    { outcome: 'already match the database', count: stats.unchanged },
    { outcome: 'REJECTED (see below)', count: problems.length },
  ])

  if (problems.length > 0) {
    console.log(`\n${problems.length} row(s) rejected -- these are NOT written:`)
    console.table(problems.slice(0, 25))
    if (problems.length > 25) console.log(`  ...and ${problems.length - 25} more`)
  }

  if (updates.length === 0) {
    console.log('\nNothing to write.')
    return
  }

  const overwriting = updates.filter((u) => u.wasSource != null && u.wasSource !== 'manual')
  if (overwriting.length > 0) {
    console.log(`\n${overwriting.length} of these replace an upstream (erply/woo) value with this shipment's real measurement.`)
  }

  if (!APPLY) {
    console.log('\nSample of what would be written:')
    console.table(updates.slice(0, 10).map((u) => ({
      sku: u.sku,
      dims: `${u.fields.case_length_in} x ${u.fields.case_width_in} x ${u.fields.case_height_in} in`,
      weight: `${u.fields.case_weight_lb} lb`,
      changed: u.changed.length,
      was: u.wasSource ?? '(empty)',
    })))
    console.log(`\nDry run -- nothing written. Re-run with --apply to write ${updates.length} rows.`)
    return
  }

  let written = 0
  let failed = 0
  for (let i = 0; i < updates.length; i += 8) {
    await Promise.all(updates.slice(i, i + 8).map(async (u) => {
      const { error } = await supabase.from('products').update(u.fields).eq('id', u.id)
      if (error) {
        if (failed === 0) console.error(`First failure (${u.sku}): ${error.message}`)
        failed++
        return
      }
      written++
    }))
  }
  console.log(`Done: ${written} products updated${failed > 0 ? `, ${failed} failed` : ''}.`)
  if (failed > 0) process.exitCode = 1
}

await main()
