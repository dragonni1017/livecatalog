// import-measurement-worklist.mjs
// Run with: node scripts/import-measurement-worklist.mjs                        (dry run)
//           node scripts/import-measurement-worklist.mjs --apply
//           node scripts/import-measurement-worklist.mjs --file=data/other.xlsx --by=warehouse@ly-usa.com
//
// Reads hand-measured carton dimensions and weights out of a filled-in
// worklist (scripts/build-measurement-worklist.mjs produces the template)
// and writes them to Supabase as measurements_source='manual'.
//
// 'manual' is the top of the precedence order: backfill-product-measurements
// .mjs skips any row marked manual, so once a carton has been physically
// measured the nightly-ish Erply/Woo backfill can never overwrite it. That
// matters more than usual here because Erply's own values are unstable --
// it reported dimensions for ~200 products at 20:29 on 2026-09-11 and
// length="0" for the same products 20 minutes later.
//
// UNITS ARE INCHES AND POUNDS, matching the template's column headers and
// migration 0045's columns. Nothing is converted.
//
// A sheet filled in in CENTIMETRES AND KILOGRAMS cannot be detected here,
// and the validation below does not pretend to. Checked against real data
// 2026-09-11: cm+kg entry lands near 0.0002 lb/in3, and genuine bulky-light
// products (artificial flowers, ribbon, wreaths) run from 0.00002 upward
// with p1 at 0.00014 -- the two ranges overlap, so any density floor that
// caught a metric sheet would reject dozens of real cartons. The only
// defences are the column headers saying "(in)" and "(lb)" and this note.
// Gram entry IS caught, by the absolute weight ceiling.
//
// Only the four Case columns are read. Per-piece measurements were dropped
// from scope 2026-09-11 (bins hold sealed cases), so Unit columns are
// ignored even if present in an older template.
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

const INPUT = path.resolve(ROOT, fileArg ?? path.join('data', 'measurement-worklist.xlsx'))
const UPDATED_BY = byArg ?? 'import-measurement-worklist.mjs'

const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing in .env.local: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
if (!fs.existsSync(INPUT)) {
  console.error(`No such file: ${INPUT}`)
  process.exit(1)
}

const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// Template header -> column. Anything else on the sheet (Name, Category,
// Pack spec, In stock, Notes) is context for whoever fills it in and is not
// imported.
const COLUMN_FOR_HEADER = {
  'Case L (in)': 'case_length_in',
  'Case W (in)': 'case_width_in',
  'Case H (in)': 'case_height_in',
  'Case Wt (lb)': 'case_weight_lb',
}
const FIELDS = Object.values(COLUMN_FOR_HEADER)

// Accepts what a person actually types into a spreadsheet: a number, or a
// number with a unit or stray character stuck to it ('12 in', '12"', '12.5
// lb'). Rejects anything with no leading number, and anything with a second
// number in it ('12-14', '12 x 8') since that's ambiguous rather than sloppy.
function parseCell(raw) {
  if (raw === null || raw === undefined) return { value: null }
  const text = String(raw).trim()
  if (text === '') return { value: null }
  if (/\d\s*(?:[-x×,/]|\bto\b)\s*\d/i.test(text)) return { error: `ambiguous value "${text}"` }
  const m = text.match(/^([0-9]*\.?[0-9]+)\s*(?:in|inch|inches|"|lb|lbs|pound|pounds)?\.?$/i)
  if (!m) return { error: `unparseable value "${text}"` }
  const n = Number(m[1])
  if (!Number.isFinite(n)) return { error: `unparseable value "${text}"` }
  if (n <= 0) return { error: `value must be greater than zero ("${text}")` }
  if (n > 999999.99) return { error: `value too large for numeric(8,2) ("${text}")` }
  return { value: Math.round(n * 100) / 100 }
}

// Same tests as the worklist generator, applied at the door this time: a
// hand-entered carton has to be physically possible before it lands in the
// table a capacity plan reads.
//
// The two absolute bounds are set from the real distribution of 2,244
// backfilled cartons (2026-09-11), not invented: weight p50 is 30.9 lb, p99
// is 64, max is 189.6, so a 250 lb ceiling rejects nothing real while
// catching a weight typed in grams. Dimensions run p50 18 in, p99 49, max
// 188, so a 120 in ceiling only catches an extra digit.
const LEAD_LB_PER_IN3 = 0.41
const MAX_WEIGHT_LB = 250
const MAX_DIMENSION_IN = 120

function implausible(v) {
  const dims = [v.case_length_in, v.case_width_in, v.case_height_in]

  const tiny = dims.filter((d) => d != null && d < 1)
  if (tiny.length > 0) return `dimension under 1 inch (${tiny.join(', ')})`

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

async function fetchCatalog() {
  const bySku = new Map()
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('products')
      .select(`id, sku, is_active, measurements_source, ${FIELDS.join(', ')}`)
      .order('sku').range(from, from + 999)
    if (error) {
      if (/case_weight_lb|column/.test(error.message)) {
        console.error('Columns missing -- apply supabase/migrations/0045_product_measurements.sql first.')
        return null
      }
      throw new Error(error.message)
    }
    for (const row of data) if (row.sku) bySku.set(String(row.sku).trim(), row)
    if (data.length < 1000) break
  }
  return bySku
}

function readSheets() {
  const wb = XLSX.readFile(INPUT)
  const entries = []
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: null })
    // The Summary sheet has no SKU column; skip rather than warn about it.
    if (rows.length === 0 || !('SKU' in rows[0])) continue
    rows.forEach((row, i) => {
      entries.push({ sheetName, rowNumber: i + 2, row }) // +2: header row plus 1-indexing
    })
  }
  return entries
}

async function main() {
  const catalog = await fetchCatalog()
  if (catalog === null) { process.exitCode = 1; return }

  const entries = readSheets()
  console.log(`${INPUT}`)
  console.log(`${entries.length} data rows across the sheets with a SKU column; ${catalog.size} products in Supabase.\n`)

  const updates = []
  const problems = []
  const stats = { blank: 0, unknownSku: 0, unchanged: 0, inactive: 0 }

  for (const { sheetName, rowNumber, row } of entries) {
    const where = `${sheetName} row ${rowNumber}`
    const sku = String(row.SKU ?? '').trim()
    if (!sku) continue

    const next = {}
    let bad = false
    for (const [header, field] of Object.entries(COLUMN_FOR_HEADER)) {
      const { value, error } = parseCell(row[header])
      if (error) { problems.push({ where, sku, problem: `${header}: ${error}` }); bad = true; continue }
      if (value != null) next[field] = value
    }
    if (bad) continue

    // A row with nothing filled in is the normal case for an untouched
    // template, not a problem worth reporting.
    if (Object.keys(next).length === 0) { stats.blank++; continue }

    const product = catalog.get(sku)
    if (!product) { stats.unknownSku++; problems.push({ where, sku, problem: 'SKU not found in Supabase' }); continue }
    if (product.is_active === false) stats.inactive++

    // Merge over what's already stored before checking plausibility, so a
    // row supplying only a weight is judged against its existing dimensions
    // rather than passing unchecked.
    const merged = {}
    for (const f of FIELDS) merged[f] = next[f] ?? (product[f] == null ? null : Number(product[f]))
    const reason = implausible(merged)
    if (reason) { problems.push({ where, sku, problem: reason }); continue }

    const same = (a, b) => (a == null ? null : Number(a)) === (b == null ? null : Number(b))
    const changed = Object.keys(next).filter((f) => !same(product[f], next[f]))
    if (changed.length === 0) { stats.unchanged++; continue }

    updates.push({
      id: product.id,
      sku,
      fields: {
        ...next,
        measurements_source: 'manual',
        measurements_updated_at: new Date().toISOString(),
        measurements_updated_by: UPDATED_BY,
      },
      changed,
      wasSource: product.measurements_source,
    })
  }

  console.table([
    { outcome: 'to write', count: updates.length },
    { outcome: 'blank rows (nothing filled in)', count: stats.blank },
    { outcome: 'already match the database', count: stats.unchanged },
    { outcome: 'REJECTED (see below)', count: problems.length },
  ])
  if (stats.inactive > 0) console.log(`Note: ${stats.inactive} of the rows to write are inactive products.`)

  if (problems.length > 0) {
    console.log(`\n${problems.length} row(s) rejected -- these are NOT written, fix the sheet and re-run:`)
    console.table(problems.slice(0, 25))
    if (problems.length > 25) console.log(`  ...and ${problems.length - 25} more`)
  }

  if (updates.length === 0) {
    console.log('\nNothing to write.')
    return
  }

  // Overwriting a value that came from Erply/Woo is the intended behaviour --
  // a physical measurement beats an upstream guess -- but it's worth seeing.
  const overwriting = updates.filter((u) => u.wasSource != null && u.wasSource !== 'manual')
  if (overwriting.length > 0) {
    console.log(`\n${overwriting.length} of these replace an upstream (erply/woo) value with the hand measurement.`)
  }

  if (!APPLY) {
    console.log('\nSample of what would be written:')
    console.table(updates.slice(0, 10).map((u) => ({
      sku: u.sku,
      dims: `${u.fields.case_length_in ?? '-'} x ${u.fields.case_width_in ?? '-'} x ${u.fields.case_height_in ?? '-'} in`,
      weight: u.fields.case_weight_lb != null ? `${u.fields.case_weight_lb} lb` : '-',
      changed: u.changed.length,
      was: u.wasSource ?? '(empty)',
    })))
    console.log(`\nDry run -- nothing written. Re-run with --apply to write ${updates.length} rows.`)
    return
  }

  // Per-row UPDATE, not a batched upsert: an id-only upsert payload fails
  // Postgres' NOT NULL check on `sku` before ON CONFLICT resolution ever
  // runs, and padding the payload to get around that would let this script
  // insert products. See backfill-product-measurements.mjs for the full note.
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
  if (failed > 0) {
    console.error('Re-running is safe -- rows already written are skipped as "already match the database".')
    process.exitCode = 1
  }
}

await main()
