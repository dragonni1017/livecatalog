// build-qb-product-fill-sheet.ts
// Run with: node scripts/build-qb-product-fill-sheet.ts
//           node scripts/build-qb-product-fill-sheet.ts --plan=data/qb-product-create-plan-20261001.csv
//
// Read-only. Turns the planner's output (scripts/create-products-from-qb.ts ->
// data/qb-product-create-plan-<YYYYMMDD>.csv) into a fill-in xlsx for the
// rows that can't be created yet: the pack spec QuickBooks never states
// (pieces per pack), a category, or a human decision. Modelled on
// scripts/build-measurement-worklist.mjs: one row shape, read-only context
// columns on the left, empty fill-in columns on the right, an instructions
// sheet, and a matching importer (scripts/import-qb-product-fill-sheet.ts).
//
// Prefilled so the person only fills gaps: pack figures the QB desc stated
// (or the plush rule Dragon approved 2026-10-01 supplied), the category where
// the planner had a confident proposal, and -- for the QB typos -- a corrected
// spelling in "Name override" that is APPLIED ON IMPORT UNLESS CLEARED. Notes
// say so on every such row; nothing is corrected silently.
//
// Categories: the community `xlsx` package (0.18.x) cannot WRITE data
// validation (a SheetJS Pro feature), so there is no dropdown. A
// "Categories" sheet lists the live names and the importer rejects anything
// not on it.
//
// Writes: data/qb-product-fill-in-<YYYYMMDD>.xlsx. Writes nothing to any system.
//
// Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })

const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing in .env.local: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}
const db = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

/** Newest data/qb-product-create-plan-YYYYMMDD.csv (not the --only variants). */
function latestPlan(): string | null {
  const dir = path.join(ROOT, 'data')
  const hits = fs.readdirSync(dir).filter((f) => /^qb-product-create-plan-\d{8}\.csv$/.test(f)).sort()
  return hits.length ? path.join(dir, hits[hits.length - 1]) : null
}

const planArg = process.argv.find((a) => a.startsWith('--plan='))?.slice(7)
const PLAN = planArg ? path.resolve(ROOT, planArg) : latestPlan()
if (!PLAN || !fs.existsSync(PLAN)) {
  console.error('No plan CSV found. Run node scripts/create-products-from-qb.ts first.')
  process.exit(1)
}

type Row = Record<string, string>
// raw:true keeps every CSV cell a string ("20/pk" must never become a date).
const planWb = XLSX.readFile(PLAN, { raw: true })
const plan: Row[] = XLSX.utils.sheet_to_json(planWb.Sheets[planWb.SheetNames[0]], { defval: '', raw: true })
const planned = plan.filter((r) => r.planned_sku)

const { data: cats, error } = await db.from('categories').select('id, name').order('name')
if (error) { console.error(`categories: ${error.message}`); process.exit(1) }
const categories = (cats ?? []) as { id: string; name: string }[]

// Row-specific context that no rule in the planner produces. Keyed by SKU.
const KNOWN_NOTES: Record<string, string> = {
  T642208:
    'DECIDE WHICH SKU. The photo T642208.jpg (+4 views) shows FLOWER TUMBLERS, labelled T642208, 20/CS, UPC 737879106143 -- ' +
    'that matches QB "T642208-tumbler", NOT this bare QB record (a "Mini Suitecase Makeup Station", Toys/Dolls sub-item, $0). ' +
    'Which SKU should the tumbler be created under? Fill in ONE of the two T642208 rows and put a reason in Skip on the other.',
  'T642208-TUMBLER':
    'DECIDE WHICH SKU. See the T642208 row: the photo is this product (flower tumblers, 20/CS, UPC 737879106143) but is filed ' +
    'under the bare SKU T642208. Fill in ONE of the two rows and Skip the other. The photos attach to whichever row you keep.',
  K229497:
    'CHECK THE CASE QTY. QB says 40pc/cs; every one of its 12 K2294xx/K2295xx keychain siblings says 240pc/cs. ' +
    'If 40 is a typo, fix it in QuickBooks first -- the importer checks your pack figures against the QB desc.',
  'P273858-60CM':
    'NO PHOTO of this variant on disk (only P273858-45cm has one). Put a reason in Skip unless you want it created without a photo.',
}

const isComplete = (r: Row) => r.name_status === 'ok' && !!r.catalog_category_id && !!r.erply_group_id && !r.skip_reason
const todo = planned.filter((r) => !isComplete(r))

function needsOf(r: Row): string[] {
  const n: string[] = []
  if (!r.pieces_per_pack || !r.packs_per_case || !r.sold_by) n.push('pack spec')
  if (!r.catalog_category_id) n.push('category')
  else if (!r.erply_group_id) n.push('category (no Erply group resolves to it)')
  if (r.sku_basis === 'ambiguous') n.push('DECIDE SKU')
  if (r.sku_basis === 'no_photo') n.push('decide (no photo)')
  if (/suspected QB typo/.test(r.name_notes)) n.push('check spelling')
  return n
}

/** The QB typo corrections the planner flagged, offered -- never applied -- as an override. */
function typoOverride(r: Row): { override: string; note: string } {
  let base = r.proposed_base
  const fixes: string[] = []
  for (const m of r.name_notes.matchAll(/suspected QB typo "([^"]+)" \(-> ([^)]+)\)/g)) {
    const uncertain = m[2].endsWith('?')
    const to = m[2].replace(/\?$/, '')
    base = base.replace(new RegExp(`\\b${m[1]}\\b`, 'g'), to)
    fixes.push(`"${m[1]}" -> "${to}"${uncertain ? ' (UNCERTAIN -- check the product)' : ''}`)
  }
  if (!fixes.length) return { override: '', note: '' }
  return { override: base, note: `Name override PREFILLED with a spelling fix ${fixes.join(', ')}. It is applied on import; clear the cell to keep the QuickBooks spelling.` }
}

const FILL = {
  pk: 'Pieces per pack',
  bx: 'Packs (boxes) per case',
  soldBy: 'Sold by (piece/pack)',
  category: 'Category',
  name: 'Name override (base name only, no pack spec)',
  skip: 'Skip (reason)',
}

const sheetRows = todo.map((r) => {
  const t = typoOverride(r)
  const notes = [KNOWN_NOTES[r.planned_sku.toUpperCase()], t.note, r.name_notes, r.skip_reason ? `PLANNER SKIPPED: ${r.skip_reason}` : '', r.category_basis]
    .filter(Boolean).join(' | ')
  return {
    SKU: r.planned_sku,
    'Photo SKU': r.photo_sku,
    Needs: needsOf(r).join('; '),
    'QB description': r.qb_desc,
    'Proposed name': r.proposed_name,
    'Desc stated': r.stated_pack,
    'Case L (in)': r.case_length_in,
    'Case W (in)': r.case_width_in,
    'Case H (in)': r.case_height_in,
    'Case Wt (lb)': r.case_weight_lb,
    'QB price (info only)': r.qb_price,
    'Photo file(s)': r.photo_files || (r.candidate_photo_files_unconfirmed ? `UNCONFIRMED: ${r.candidate_photo_files_unconfirmed}` : '(none)'),
    [FILL.pk]: r.pieces_per_pack ? Number(r.pieces_per_pack) : '',
    [FILL.bx]: r.packs_per_case ? Number(r.packs_per_case) : '',
    [FILL.soldBy]: r.sold_by,
    [FILL.category]: r.catalog_category,
    [FILL.name]: t.override,
    [FILL.skip]: '',
    Notes: notes,
  }
})

const wb = XLSX.utils.book_new()
const fillSheet = XLSX.utils.json_to_sheet(sheetRows)
fillSheet['!cols'] = [
  { wch: 16 }, { wch: 11 }, { wch: 26 }, { wch: 48 }, { wch: 44 }, { wch: 16 },
  { wch: 9 }, { wch: 9 }, { wch: 9 }, { wch: 10 }, { wch: 10 }, { wch: 30 },
  { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 40 }, { wch: 22 }, { wch: 90 },
]
XLSX.utils.book_append_sheet(wb, fillSheet, 'Fill In')

const instructions = [
  ['HOW TO FILL THIS IN'],
  [''],
  ['One row per planned product that cannot be created yet. Fill only the six columns on the right; everything to their left is context.'],
  ['Hand the file back to: node scripts/import-qb-product-fill-sheet.ts --file=<this file>   (dry run -- it only reports)'],
  [''],
  ['THE PACK SPEC  --  the name ends  "<pk>/pk <bx>bx/cs cs.<N>"  (docs/PRODUCT-NAMING-STANDARD.md)'],
  ['  Pieces per pack         how many pieces are in one retail pack. 1 if the item is sold singly.'],
  ['  Packs (boxes) per case  how many of those packs are in one master carton.'],
  ['  Sold by = piece         the customer buys PIECES. cs.N is pieces per case, so N = pk x bx.'],
  ['                          e.g. "Foam Bear with Heart 7cm - 12/pk 10bx/cs cs.120"   (12 x 10 = 120)'],
  ['  Sold by = pack          the customer buys PACKS. cs.N is packs per case, so N = bx, written with its unit.'],
  ['                          e.g. "Happy Face Graduation Pen - 12/pk 50bx/cs cs.50pk"   (50 packs of 12)'],
  ['  The importer checks your numbers against what QuickBooks stated ("Desc stated"):'],
  ['    a bare "N/cs" must equal pk x bx when sold by piece, or bx when sold by pack; "Npk/cs" must equal bx.'],
  ['    If QuickBooks is wrong, fix it in QuickBooks first rather than here.'],
  [''],
  ['PLUSH RULE (Dragon approved 2026-10-01): a plush whose QB desc says only "N/cs" is already filled as 1/pk, N packs, piece.'],
  ['  Plush cups, keychains and multi-piece sets were NOT given that rule -- they are on this sheet to decide.'],
  [''],
  ['CATEGORY      must be spelled exactly as on the "Categories" sheet (there is no dropdown). Prefilled where the planner was confident.'],
  ['NAME OVERRIDE optional. The descriptive part only, e.g. "Graduation Hat Paper White" -- NOT the " - 20/pk ..." part, which is rebuilt.'],
  ['              Prefilled ONLY with QuickBooks spelling fixes; it is applied unless you clear it.'],
  ['SKIP          optional. Any text here (the reason) means: do not create this product.'],
  [''],
  ['Products are created HIDDEN at $0 -- prices are set by hand in Erply afterwards. The QB price column is information only.'],
  ['Carton figures are INCHES and POUNDS, taken from the QB description; they are not edited here.'],
  [''],
  [`Plan: ${path.relative(ROOT, PLAN)}   Generated ${new Date().toISOString().slice(0, 10)}`],
]
const instSheet = XLSX.utils.aoa_to_sheet(instructions)
instSheet['!cols'] = [{ wch: 140 }]
XLSX.utils.book_append_sheet(wb, instSheet, 'Instructions')

const catSheet = XLSX.utils.json_to_sheet(categories.map((c) => ({ Category: c.name })))
catSheet['!cols'] = [{ wch: 32 }]
XLSX.utils.book_append_sheet(wb, catSheet, 'Categories')

const tally = (pred: (r: Row) => boolean) => todo.filter(pred).length
const summary = [
  { Metric: 'Planned products', Count: planned.length },
  { Metric: 'Complete already (not on the sheet)', Count: planned.length - todo.length },
  { Metric: 'On the Fill In sheet', Count: todo.length },
  { Metric: '  need a pack spec', Count: tally((r) => needsOf(r).includes('pack spec')) },
  { Metric: '  need a category', Count: tally((r) => needsOf(r).some((n) => n.startsWith('category'))) },
  { Metric: '  need a SKU decision (T642208)', Count: tally((r) => r.sku_basis === 'ambiguous') },
  { Metric: '  spelling to check (prefilled override)', Count: tally((r) => /suspected QB typo/.test(r.name_notes)) },
  { Metric: '  pack figures already prefilled', Count: tally((r) => !!r.pieces_per_pack && !!r.packs_per_case) },
  { Metric: '  category already prefilled', Count: tally((r) => !!r.catalog_category) },
]
const sumSheet = XLSX.utils.json_to_sheet(summary)
sumSheet['!cols'] = [{ wch: 44 }, { wch: 8 }]
XLSX.utils.book_append_sheet(wb, sumSheet, 'Summary')

const now = new Date()
const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
const outPath = path.join(ROOT, 'data', `qb-product-fill-in-${stamp}.xlsx`)
XLSX.writeFile(wb, outPath)
console.log(`plan: ${path.relative(ROOT, PLAN)}`)
console.table(summary)
console.log(`Wrote -> ${outPath}`)
