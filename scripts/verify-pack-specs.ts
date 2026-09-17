// verify-pack-specs.ts
// Run with: node scripts/verify-pack-specs.ts
//           node scripts/verify-pack-specs.ts --csv --xlsx
//           node scripts/verify-pack-specs.ts --dir="<folder of supplier workbooks>"
//
// REPORT ONLY. Writes nothing to Supabase, Erply or WooCommerce, and
// deliberately proposes no corrected names -- see the warning below.
//
// Gathers, for each name that fits NEITHER pack-spec convention, whatever the
// supplier documents say about it. Every "Original List" / "Arrival List"
// workbook states total pieces and carton count per SKU, so pieces / cartons
// gives the PIECES PER CARTON for that shipment.
//
// *** THAT IS NOT NECESSARILY THE SELLING CASE QUANTITY. ***
//
// An earlier version of this script treated it as exactly that and generated
// 264 "confirmed corrections". Wrong: for a PACK-SOLD product cs.N counts
// packs, not pieces. Dragon confirmed 2026-09-17 that the floral papers are 20
// per pack with 60 PACKS per case, while their documents read 60 pieces per
// carton — so applying those corrections would have rewritten 225 correct
// names. An even earlier version proposed reverting the deliberate Gift Bow
// renames.
//
// So these figures are CONTEXT for a human, not an answer.
// scripts/audit-product-names.ts identifies which names actually need looking
// at (both conventions considered); this says what the paperwork shows for
// them.

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
  perCarton: number
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
        // Only a whole-number figure is evidence. A line whose pieces don't
        // divide evenly by cartons is a mixed carton, and rounding it would
        // invent a number.
        if (!line.cartons || line.piecesPerCase == null) continue
        const key = line.sku.toUpperCase()
        if (!bySku.has(key)) bySku.set(key, [])
        bySku.get(key)!.push({
          file,
          pieces: line.qtyShipped,
          cartons: line.cartons,
          perCarton: line.piecesPerCase,
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

// ── The names that fit neither convention ────────────────────────────────

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

type Verdict = 'documents-agree' | 'documents-disagree' | 'no-document'

interface Row {
  sku: string
  name: string
  csInName: number
  /** Pieces per carton, when every document agrees. NOT the case quantity. */
  piecesPerCarton: number | null
  verdict: Verdict
  evidence: string
  note: string
}

const rows: Row[] = []

for (const p of products) {
  const audit = auditProductName(p.name ?? '')
  if (!audit.issues.includes('case_total_mismatch')) continue

  const spec = audit.parsed.spec!
  const obs = bySku.get(p.sku.toUpperCase()) ?? []
  const distinct = [...new Set(obs.map((o) => o.perCarton))].sort((a, b) => a - b)

  let verdict: Verdict = 'no-document'
  let note = ''

  if (distinct.length === 1) {
    verdict = 'documents-agree'
    const perCarton = distinct[0]
    const pk = spec.piecesPerPack
    note =
      `${perCarton} pieces per carton. ` +
      (perCarton % pk === 0
        ? `Piece-sold, that reads ${pk}/pk ${perCarton / pk}bx/cs cs.${perCarton}; pack-sold, cs.${perCarton / pk}.`
        : `The name's ${pk}/pk doesn't divide ${perCarton}, so the pack size looks wrong too.`) +
      ` Which convention applies is a human call.`
  } else if (distinct.length > 1) {
    verdict = 'documents-disagree'
    note = `${distinct.join(', ')} pieces per carton across ${obs.length} shipment(s) — packing changed between shipments`
  } else {
    note = 'this SKU appears in none of the supplier documents scanned'
  }

  rows.push({
    sku: p.sku,
    name: p.name ?? '',
    csInName: spec.piecesPerCase,
    piecesPerCarton: distinct.length === 1 ? distinct[0] : null,
    verdict,
    evidence: obs.map((o) => `${o.perCarton}/ctn (${o.pieces}pcs/${o.cartons}ctn) ${o.file.slice(0, 40)}`).join(' | '),
    note,
  })
}

const byVerdict = (v: Verdict) => rows.filter((r) => r.verdict === v)

console.log(`${rows.length} name(s) fit neither pack-spec convention:\n`)
for (const r of rows) {
  console.log(`  ${r.sku}  ${r.name}`)
  console.log(`      ${r.note}`)
}
console.log(
  `\n  documents agree: ${byVerdict('documents-agree').length}` +
    `   disagree: ${byVerdict('documents-disagree').length}` +
    `   no document: ${byVerdict('no-document').length}`,
)

const sheetRows = (subset: Row[]) =>
  subset.map((r) => ({
    SKU: r.sku,
    'Current name': r.name,
    'cs.N in name': r.csInName,
    'Pieces per carton (documents)': r.piecesPerCarton ?? '',
    Note: r.note,
    Evidence: r.evidence,
  }))

// One tab per verdict. NO corrected-name column, deliberately: the documents
// give pieces per carton, which is the case quantity only for a piece-sold
// product, and nothing here can tell which convention a SKU follows.
if (WRITE_XLSX) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetRows(byVerdict('documents-agree'))), 'Documents agree')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetRows(byVerdict('documents-disagree'))), 'Documents disagree')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetRows(byVerdict('no-document'))), 'No document found')

  const dest = path.join(ROOT, 'data', 'pack-spec-verification.xlsx')
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  XLSX.writeFile(wb, dest)
  console.log(`\nWorkbook written to ${dest}`)
}

if (WRITE_CSV) {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const out = [
    'sku,current_name,cs_in_name,pieces_per_carton_documents,verdict,note,evidence',
    ...rows.map((r) =>
      [
        r.sku,
        esc(r.name),
        String(r.csInName),
        String(r.piecesPerCarton ?? ''),
        r.verdict,
        esc(r.note),
        esc(r.evidence),
      ].join(','),
    ),
  ]
  const dest = path.join(ROOT, 'data', 'pack-spec-verification.csv')
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, out.join('\n') + '\n')
  console.log(`\nFull list written to ${dest}`)
}

console.log('\nNothing was changed, and no name is proposed. Names are synced from Erply.')
