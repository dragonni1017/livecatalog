// verify-pack-specs.ts
// Run with: node scripts/verify-pack-specs.ts
//           node scripts/verify-pack-specs.ts --csv
//           node scripts/verify-pack-specs.ts --dir="<folder of supplier workbooks>"
//
// REPORT ONLY. Writes nothing to Supabase, Erply or WooCommerce.
//
// Answers the question the name audit deliberately refuses to guess at: for a
// product whose name says `cs.N` that isn't pk x bx, what IS the real number
// of pieces per case?
//
// The supplier documents know. Every "Original List" / "Arrival List"
// workbook states, per SKU, the total pieces and the carton count for that
// shipment -- and pieces / cartons is the per-case quantity, arithmetic that
// can't be misread the way the sheet's own pk/cs column can. Proven on
// container EGSU9522424: S162782 ships 1,920 pieces in 80 cartons and its
// pk/cs column reads 24, which is exactly 1920/80.
//
// So this scans the whole folder, indexes SKU -> per-case quantity per
// document, and reports for each flagged name whether the documents CONFIRM a
// figure, DISAGREE with each other, or say nothing at all. A disagreement is
// reported, never averaged: packing genuinely changes between shipments, and
// picking one would be the same guess this exists to avoid.
//
// See docs/PRODUCT-NAMING-STANDARD.md for why cs.N cannot be recomputed from
// pk x bx: F287672 physically arrives 150 per case and reads "48/pk 150bx/cs
// cs.150", so the arithmetic "fix" would have written cs.7200.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { createRequire } from 'module'
import { auditProductName } from '../lib/product-naming.ts'
import { groupLinesBySku, parsePackingListSheet, type SheetRow } from '../lib/packing-list.ts'

const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const XLSX: any = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })

const WRITE_CSV = process.argv.includes('--csv')
const WRITE_XLSX = process.argv.includes('--xlsx')
const DEFAULT_DIR = 'C:/Users/Dragon/OneDrive - L&Y USA/L&Y/L&Y/import documents'
const DIR = process.argv.find((a) => a.startsWith('--dir='))?.slice('--dir='.length) ?? DEFAULT_DIR

if (!fs.existsSync(DIR)) {
  console.error(`No such folder: ${DIR}\nPass --dir="<path>" if the documents live elsewhere.`)
  process.exit(1)
}

// Only the structured spreadsheets. The PDFs in the same folder (arrival
// notices, bills of lading) have no SKU column and were never validated.
const files = fs
  .readdirSync(DIR)
  .filter((f) => /\.(xlsx|xls)$/i.test(f))
  .filter((f) => /original list|arrival list|packing list/i.test(f))
  .filter((f) => !f.startsWith('~$')) // Excel lock files

console.log(`Scanning ${files.length} supplier workbook(s) in\n  ${DIR}\n`)

interface Observation {
  file: string
  pieces: number
  cartons: number
  perCase: number
}

const bySku = new Map<string, Observation[]>()
let parsed = 0
const skipped: Array<{ file: string; why: string }> = []

for (const file of files) {
  try {
    const wb = XLSX.readFile(path.join(DIR, file))
    let found = false
    for (const sheetName of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null }) as SheetRow[]
      const hasSku = rows
        .slice(0, 10)
        .some((r) => Array.isArray(r) && r.some((c) => typeof c === 'string' && c.includes('货号')))
      if (!hasSku) continue

      for (const line of groupLinesBySku(parsePackingListSheet(rows).lines)) {
        // Only a whole-number per-case figure is evidence. A line whose
        // pieces don't divide evenly by cartons is a mixed carton, and
        // rounding it would invent the very number this is checking.
        if (!line.cartons || line.piecesPerCase == null) continue
        const key = line.sku.toUpperCase()
        if (!bySku.has(key)) bySku.set(key, [])
        bySku.get(key)!.push({
          file,
          pieces: line.qtyShipped,
          cartons: line.cartons,
          perCase: line.piecesPerCase,
        })
      }
      found = true
      break
    }
    if (found) parsed++
    else skipped.push({ file, why: 'no sheet with a 货号 column' })
  } catch (err) {
    skipped.push({ file, why: (err as Error).message.slice(0, 120) })
  }
}

console.log(`  parsed ${parsed}, skipped ${skipped.length}`)
console.log(`  ${bySku.size} distinct SKUs observed across those documents\n`)

// ── The flagged names ─────────────────────────────────────────────────────

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const products: Array<{ sku: string; name: string | null }> = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await db.from('products').select('sku, name').range(from, from + 999)
  if (error) throw error
  products.push(...data)
  if (data.length < 1000) break
}

type Verdict = 'confirmed' | 'conflicting' | 'no-evidence'

interface Row {
  sku: string
  name: string
  namedCase: number
  /** What the supplier documents say, when they agree. */
  documentCase: number | null
  verdict: Verdict
  evidence: string
  suggestion: string
  note: string
}

const rows: Row[] = []

for (const p of products) {
  const audit = auditProductName(p.name ?? '', { sku: p.sku })
  if (!audit.issues.includes('case_total_mismatch')) continue

  const spec = audit.parsed.spec!
  const obs = bySku.get(p.sku.toUpperCase()) ?? []
  const distinct = [...new Set(obs.map((o) => o.perCase))].sort((a, b) => a - b)

  let verdict: Verdict = 'no-evidence'
  let suggestion = ''
  let note = ''

  if (distinct.length === 1) {
    verdict = 'confirmed'
    const trueCase = distinct[0]
    const pk = spec.piecesPerPack
    if (trueCase % pk === 0) {
      // The pack size divides the real case quantity, so only bx and cs.N
      // were wrong.
      suggestion = `${audit.parsed.base} - ${pk}/pk ${trueCase / pk}bx/cs cs.${trueCase}`
      note = `documents agree on ${trueCase}/case; keeping ${pk}/pk gives ${trueCase / pk}bx/cs`
    } else {
      note =
        `documents agree on ${trueCase}/case, but the name's ${pk}/pk doesn't divide it ` +
        `— the pack size is wrong too, so a human has to say what a pack is`
    }
  } else if (distinct.length > 1) {
    verdict = 'conflicting'
    note = `documents disagree: ${distinct.join(', ')} per case across ${obs.length} shipment(s) — packing changed, needs a decision`
  } else {
    note = 'this SKU appears in none of the supplier documents scanned'
  }

  rows.push({
    sku: p.sku,
    name: p.name ?? '',
    namedCase: spec.piecesPerCase,
    documentCase: distinct.length === 1 ? distinct[0] : null,
    verdict,
    evidence: obs.map((o) => `${o.perCase}/case (${o.pieces}pcs/${o.cartons}ctn) ${o.file.slice(0, 40)}`).join(' | '),
    suggestion,
    note,
  })
}

const byVerdict = (v: Verdict) => rows.filter((r) => r.verdict === v)
const confirmed = byVerdict('confirmed')
const fixable = confirmed.filter((r) => r.suggestion)

console.log(`${rows.length} names have cs.N that isn't pk x bx.\n`)
console.log(`  confirmed by documents       : ${confirmed.length}  (${fixable.length} with a complete corrected name)`)
console.log(`  documents disagree           : ${byVerdict('conflicting').length}`)
console.log(`  not in any document scanned  : ${byVerdict('no-evidence').length}\n`)

console.log('Examples where the documents settle it:')
for (const r of fixable.slice(0, 12)) {
  console.log(`  ${r.sku}`)
  console.log(`    now: ${r.name}`)
  console.log(`    ->   ${r.suggestion}`)
  console.log(`    why: ${r.note}`)
}

if (byVerdict('conflicting').length) {
  console.log('\nExamples where documents disagree (left alone):')
  for (const r of byVerdict('conflicting').slice(0, 6)) {
    console.log(`  ${r.sku}: ${r.note}`)
  }
}

// An .xlsx as well as the CSV, because this list is worked through by hand in
// Excel: one tab per verdict so the actionable 300 aren't mixed with the ones
// still needing a decision, plus a pattern summary — the 271 corrections are
// only 14 distinct shapes, and the largest covers 225 products, so reviewing
// the patterns is far quicker than reading 271 rows.
if (WRITE_XLSX) {
  const SPEC = /(\d+)\/pk\s+(\d+)bx\/cs\s+cs\.(\d+)/

  const sheetRows = (subset: Row[]) =>
    subset.map((r) => ({
      SKU: r.sku,
      'Current name': r.name,
      'Case qty in name': r.namedCase,
      'Case qty per documents': r.documentCase ?? '',
      'Corrected name': r.suggestion,
      'Field that was wrong':
        r.suggestion && r.documentCase != null
          ? r.documentCase === r.namedCase
            ? 'bx (cs.N was right)'
            : 'cs.N'
          : '',
      Note: r.note,
      Evidence: r.evidence,
    }))

  const patterns = new Map<string, number>()
  for (const r of rows) {
    if (!r.suggestion) continue
    const a = SPEC.exec(r.name)
    const b = SPEC.exec(r.suggestion)
    if (!a || !b) continue
    const key = `${a[1]}/pk ${a[2]}bx/cs cs.${a[3]}  ->  ${b[1]}/pk ${b[2]}bx/cs cs.${b[3]}`
    patterns.set(key, (patterns.get(key) ?? 0) + 1)
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      [...patterns.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([pattern, count]) => ({ Products: count, Correction: pattern })),
    ),
    'Patterns',
  )
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetRows(byVerdict('confirmed'))), 'Confirmed')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetRows(byVerdict('conflicting'))), 'Documents disagree')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetRows(byVerdict('no-evidence'))), 'No document found')

  const dest = path.join(ROOT, 'data', 'pack-spec-verification.xlsx')
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  XLSX.writeFile(wb, dest)
  console.log(`\nWorkbook written to ${dest}`)
}

if (WRITE_CSV) {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const out = [
    'sku,current_name,named_case_qty,document_case_qty,verdict,suggested_name,note,evidence',
    ...rows.map((r) =>
      [r.sku, esc(r.name), String(r.namedCase), String(r.documentCase ?? ''), r.verdict, esc(r.suggestion), esc(r.note), esc(r.evidence)].join(','),
    ),
  ]
  const dest = path.join(ROOT, 'data', 'pack-spec-verification.csv')
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, out.join('\n') + '\n')
  console.log(`\nFull list written to ${dest}`)
}

console.log('\nNothing was changed. Names are synced from Erply, so any correction must be made there.')
