// import-qb-product-fill-sheet.ts
// Run with: node scripts/import-qb-product-fill-sheet.ts                                  (dry run -- the only mode)
//           node scripts/import-qb-product-fill-sheet.ts --file=data/qb-product-fill-in-20261001.xlsx
//           node scripts/import-qb-product-fill-sheet.ts --plan=data/qb-product-create-plan-20261001.csv
//
// DRY RUN ONLY. Reads a filled-in sheet from scripts/build-qb-product-fill-sheet.ts,
// validates it, rebuilds each product name with lib/product-naming.ts
// (buildProductName + auditProductName), and writes an updated plan:
// data/qb-product-create-plan-<YYYYMMDD>-from-fill.csv, one row per planned
// SKU (sheet rows plus the plan rows that were already complete), each with a
// status: ready / incomplete / error / skipped.
//
// Writes NOTHING to Erply, WooCommerce, Supabase or Cloudinary. Reads the
// live category list (Supabase) and the Erply product list (getProducts only)
// to resolve the Erply group a category maps to. See the --apply TODO at the
// bottom of scripts/create-products-from-qb.ts -- the same steps apply here.
//
// Validation, per row:
//   - Pieces per pack / Packs per case: blank or a positive whole number.
//   - Sold by: piece or pack (see docs/PRODUCT-NAMING-STANDARD.md):
//       piece -> cs.N = pk x bx      pack -> cs.N = bx, written "cs.<bx>pk"
//   - Against what the QB desc stated: a bare "N/cs" must equal pk x bx
//     (piece) or bx (pack); a stated "Npk/cs" must equal bx; a stated "N/pk"
//     must equal pk. A conflict is an ERROR -- QuickBooks is the source of
//     truth for new products, so fix it there rather than in the sheet.
//   - Category: must be a live catalog category name (case-insensitive).
//   - Name override: the base only; a pack spec in it is an error.
//   - T642208-style ambiguity: of the rows sharing a photo SKU, exactly one
//     may be left un-skipped; that one is then resolved and takes the photos.
//   - The rebuilt name must pass auditProductName with no issues.
//
// Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//                         ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { auditProductName, buildProductName, normalizeDescriptor } from '../lib/product-naming.ts'
import { resolveErplyCategoryAlias } from '../lib/erply-category-aliases.ts'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })

if (process.argv.includes('--apply')) {
  console.error('--apply is not implemented. This importer is dry-run only.')
  process.exit(1)
}

const CC = process.env.ERPLY_CLIENT_CODE
const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
for (const [name, val] of Object.entries({
  ERPLY_CLIENT_CODE: CC, ERPLY_USERNAME: process.env.ERPLY_USERNAME, ERPLY_PASSWORD: process.env.ERPLY_PASSWORD,
  NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
})) {
  if (!val) { console.error(`Missing in .env.local: ${name}`); process.exit(1) }
}
const db = createClient(NEXT_PUBLIC_SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!)

const newest = (re: RegExp) => {
  const dir = path.join(ROOT, 'data')
  const hits = fs.readdirSync(dir).filter((f) => re.test(f)).sort()
  return hits.length ? path.join(dir, hits[hits.length - 1]) : null
}
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3)
const FILE = arg('file') ? path.resolve(ROOT, arg('file')!) : newest(/^qb-product-fill-in-\d{8}\.xlsx$/)
const PLAN = arg('plan') ? path.resolve(ROOT, arg('plan')!) : newest(/^qb-product-create-plan-\d{8}\.csv$/)
for (const [k, v] of [['fill sheet', FILE], ['plan CSV', PLAN]] as const) {
  if (!v || !fs.existsSync(v)) { console.error(`No ${k} found (${v ?? 'none'}).`); process.exit(1) }
}

// ── Read-only lookups ────────────────────────────────────────────────────────

async function erplyRead(params: Record<string, string>) {
  if (!['verifyUser', 'getProducts'].includes(params.request)) throw new Error(`refusing non-read Erply request ${params.request}`)
  const res = await fetch(`https://${CC}.erply.com/api/`, { method: 'POST', body: new URLSearchParams({ clientCode: CC!, ...params }) })
  if (!res.ok) throw new Error(`Erply HTTP ${res.status}`)
  const json = await res.json()
  if (json.status?.responseStatus === 'error') throw new Error(`Erply error ${json.status.errorCode}: ${json.status.errorField ?? 'unknown'}`)
  return json
}
const auth = await erplyRead({ request: 'verifyUser', username: process.env.ERPLY_USERNAME!, password: process.env.ERPLY_PASSWORD! })
const sessionKey: string = auth.records[0].sessionKey
const erplyList: { groupID?: number; groupName?: string }[] = []
for (let page = 1; ; page++) {
  const d = await erplyRead({ request: 'getProducts', sessionKey, recordsOnPage: '500', pageNo: String(page) })
  const recs = d.records ?? []
  erplyList.push(...recs)
  if (recs.length === 0 || erplyList.length >= (d.status?.recordsTotal ?? 0)) break
}

const { data: cats, error } = await db.from('categories').select('id, name')
if (error) { console.error(`categories: ${error.message}`); process.exit(1) }
const catByName = new Map(((cats ?? []) as { id: string; name: string }[]).map((c) => [c.name.toLowerCase(), c]))

/** Account-wide dominant Erply group whose name aliases to this catalog category. */
function erplyGroupFor(catName: string): { id: string; name: string } | null {
  const counts = new Map<number, { name: string; n: number }>()
  for (const p of erplyList) {
    if (!p.groupID || resolveErplyCategoryAlias(String(p.groupName ?? '')).toLowerCase() !== catName.toLowerCase()) continue
    counts.set(p.groupID, { name: p.groupName ?? '', n: (counts.get(p.groupID)?.n ?? 0) + 1 })
  }
  const best = [...counts.entries()].sort((a, b) => b[1].n - a[1].n)[0]
  return best ? { id: String(best[0]), name: best[1].name } : null
}

// ── Inputs ───────────────────────────────────────────────────────────────────

type Row = Record<string, string>
const planWb = XLSX.readFile(PLAN, { raw: true })
const plan: Row[] = XLSX.utils.sheet_to_json(planWb.Sheets[planWb.SheetNames[0]], { defval: '', raw: true })
const planBySku = new Map(plan.filter((r) => r.planned_sku).map((r) => [r.planned_sku.toUpperCase(), r]))

const fillWb = XLSX.readFile(FILE)
if (!fillWb.Sheets['Fill In']) { console.error('No "Fill In" sheet in the file.'); process.exit(1) }
const sheet: Record<string, unknown>[] = XLSX.utils.sheet_to_json(fillWb.Sheets['Fill In'], { defval: null })

const H = {
  pk: 'Pieces per pack', bx: 'Packs (boxes) per case', soldBy: 'Sold by (piece/pack)',
  category: 'Category', name: 'Name override (base name only, no pack spec)', skip: 'Skip (reason)',
}
const missingHeaders = Object.values(H).filter((h) => sheet.length && !(h in sheet[0]))
if (missingHeaders.length) { console.error(`Fill In sheet is missing column(s): ${missingHeaders.join(', ')}`); process.exit(1) }

const text = (v: unknown) => (v == null ? '' : String(v).trim())
function posInt(v: unknown, label: string): { value: number | null; error?: string } {
  const s = text(v)
  if (!s) return { value: null }
  if (!/^\d+$/.test(s) || Number(s) <= 0) return { value: null, error: `${label} must be a positive whole number (got "${s}")` }
  return { value: Number(s) }
}
function soldByOf(v: unknown): { value: 'piece' | 'pack' | null; error?: string } {
  const s = text(v).toLowerCase()
  if (!s) return { value: null }
  if (['piece', 'pieces', 'pc', 'pcs'].includes(s)) return { value: 'piece' }
  if (['pack', 'packs', 'pk', 'box', 'boxes', 'bx'].includes(s)) return { value: 'pack' }
  return { value: null, error: `Sold by must be "piece" or "pack" (got "${text(v)}")` }
}

/** buildProductName, with "4 Style" protected from normalizeDescriptor's Style-stripping (as the planner does). */
function houseName(base: string, pk: number, bx: number, soldBy: 'piece' | 'pack', unit: string): string {
  const shielded = base.replace(/(\d+)\s*-?\s*style(s)?\b/gi, '$1§')
  let name = buildProductName({ descriptor: shielded, piecesPerPack: pk, boxesPerCase: bx }).replace(/(\d+)§/g, '$1 Style')
  if (soldBy === 'pack') name = name.replace(/cs\.\d+$/, `cs.${bx}${unit === 'bx' ? 'bx' : 'pk'}`)
  return name
}

// ── Validate ─────────────────────────────────────────────────────────────────

interface Out {
  planned_sku: string; photo_sku: string; source: string; status: string; needs: string; problems: string
  final_name: string; sold_by: string; pieces_per_pack: number | ''; packs_per_case: number | ''
  catalog_category: string; catalog_category_id: string; erply_group_id: string; erply_group_name: string
  photo_files: string; case_length_in: string; case_width_in: string; case_height_in: string; case_weight_lb: string
  qb_price: string; skip_reason: string
}
const out: Out[] = []
const seen = new Set<string>()

// Ambiguous families: which rows did the human keep?
const keptByPhoto = new Map<string, string[]>()
for (const row of sheet) {
  const p = planBySku.get(text(row.SKU).toUpperCase())
  if (p?.sku_basis === 'ambiguous' && !text(row[H.skip])) keptByPhoto.set(p.photo_sku, [...(keptByPhoto.get(p.photo_sku) ?? []), p.planned_sku])
}

sheet.forEach((row, i) => {
  const sku = text(row.SKU)
  if (!sku) return
  const p = planBySku.get(sku.toUpperCase())
  const base: Out = {
    planned_sku: sku, photo_sku: p?.photo_sku ?? '', source: `sheet row ${i + 2}`, status: '', needs: '', problems: '',
    final_name: '', sold_by: '', pieces_per_pack: '', packs_per_case: '', catalog_category: '', catalog_category_id: '',
    erply_group_id: '', erply_group_name: '', photo_files: p?.photo_files ?? '',
    case_length_in: p?.case_length_in ?? '', case_width_in: p?.case_width_in ?? '', case_height_in: p?.case_height_in ?? '',
    case_weight_lb: p?.case_weight_lb ?? '', qb_price: p?.qb_price ?? '', skip_reason: '',
  }
  if (!p) { out.push({ ...base, status: 'error', problems: 'SKU is not in the plan CSV' }); return }
  seen.add(sku.toUpperCase())

  const skip = text(row[H.skip])
  if (skip) { out.push({ ...base, status: 'skipped', skip_reason: skip }); return }

  const problems: string[] = []
  const needs: string[] = []
  const pk = posInt(row[H.pk], 'Pieces per pack'); if (pk.error) problems.push(pk.error)
  const bx = posInt(row[H.bx], 'Packs per case'); if (bx.error) problems.push(bx.error)
  const sb = soldByOf(row[H.soldBy]); if (sb.error) problems.push(sb.error)

  // SKU-level blockers from the planner.
  if (p.sku_basis === 'ambiguous') {
    const kept = keptByPhoto.get(p.photo_sku) ?? []
    if (kept.length !== 1) problems.push(`undecided: ${kept.length} rows for photo ${p.photo_sku} are un-skipped (${kept.join(', ')}); Skip all but one`)
    else base.photo_files = p.photo_files || p.candidate_photo_files_unconfirmed // the human matched the photo to this SKU
  } else if (p.skip_reason && p.sku_basis !== 'no_photo') {
    problems.push(`planner skipped: ${p.skip_reason}`)
  }

  // Pack spec vs what QuickBooks stated.
  if (pk.value == null) needs.push('pieces per pack')
  if (bx.value == null) needs.push('packs per case')
  if (sb.value == null) needs.push('sold by')
  const statedPk = p.pieces_per_pack ? Number(p.pieces_per_pack) : null
  const statedBx = p.packs_per_case ? Number(p.packs_per_case) : null
  const statedCs = p.pieces_per_case_stated ? Number(p.pieces_per_case_stated) : null
  if (pk.value != null && statedPk != null && pk.value !== statedPk && p.pack_rule !== 'plush-1pk') {
    problems.push(`pieces per pack ${pk.value} conflicts with QB desc (${statedPk}/pk)`)
  }
  if (bx.value != null && statedBx != null && bx.value !== statedBx) problems.push(`packs per case ${bx.value} conflicts with QB desc (${statedBx}${p.packs_per_case_unit}/cs)`)
  if (pk.value != null && bx.value != null && sb.value && statedCs != null) {
    if (sb.value === 'piece' && pk.value * bx.value !== statedCs) problems.push(`sold by piece: ${pk.value} x ${bx.value} = ${pk.value * bx.value}, but QB desc says ${statedCs}/cs`)
    if (sb.value === 'pack' && bx.value !== statedCs) problems.push(`sold by pack: ${bx.value} packs/case, but QB desc says ${statedCs}/cs`)
  }

  // Category -> catalog id -> Erply group.
  const catText = text(row[H.category])
  if (!catText) needs.push('category')
  else {
    const cat = catByName.get(catText.toLowerCase())
    if (!cat) problems.push(`category "${catText}" is not a catalog category (see the Categories sheet)`)
    else {
      base.catalog_category = cat.name; base.catalog_category_id = cat.id
      const g = cat.id === p.catalog_category_id && p.erply_group_id ? { id: p.erply_group_id, name: p.erply_group_name } : erplyGroupFor(cat.name)
      if (!g) problems.push(`no Erply group resolves to category "${cat.name}" -- Erply needs a group to create the product`)
      else { base.erply_group_id = g.id; base.erply_group_name = g.name }
    }
  }

  // Name.
  const override = text(row[H.name])
  if (override && /\/pk|\/cs|\bcs\.\d/i.test(override)) problems.push('Name override must be the base name only (no pack spec)')
  const nameBase = override ? normalizeDescriptor(override) : p.proposed_base
  if (!nameBase) problems.push('no base name')
  if (pk.value != null && bx.value != null && sb.value && nameBase && !problems.length) {
    const name = houseName(nameBase, pk.value, bx.value, sb.value, p.packs_per_case_unit)
    const audit = auditProductName(name)
    if (audit.issues.length) problems.push(`rebuilt name fails audit (${audit.issues.join(', ')}): "${name}"`)
    else base.final_name = name
  }

  base.sold_by = sb.value ?? ''
  base.pieces_per_pack = pk.value ?? ''
  base.packs_per_case = bx.value ?? ''
  base.needs = needs.join('; ')
  base.problems = problems.join('; ')
  base.status = problems.length ? 'error' : needs.length ? 'incomplete' : 'ready'
  if (base.status === 'ready' && !base.photo_files) base.needs = 'ready, but NO PHOTO on disk'
  out.push(base)
})

// Plan rows that were already complete never went on the sheet: carry them forward.
for (const p of plan) {
  if (!p.planned_sku || seen.has(p.planned_sku.toUpperCase())) continue
  const complete = p.name_status === 'ok' && p.catalog_category_id && p.erply_group_id && !p.skip_reason
  out.push({
    planned_sku: p.planned_sku, photo_sku: p.photo_sku, source: 'plan (complete, not on sheet)',
    status: complete ? 'ready' : 'error', needs: '', problems: complete ? '' : 'incomplete plan row missing from the sheet -- rebuild the sheet',
    final_name: complete ? p.proposed_name : '', sold_by: p.sold_by, pieces_per_pack: p.pieces_per_pack ? Number(p.pieces_per_pack) : '',
    packs_per_case: p.packs_per_case ? Number(p.packs_per_case) : '', catalog_category: p.catalog_category, catalog_category_id: p.catalog_category_id,
    erply_group_id: p.erply_group_id, erply_group_name: p.erply_group_name, photo_files: p.photo_files,
    case_length_in: p.case_length_in, case_width_in: p.case_width_in, case_height_in: p.case_height_in, case_weight_lb: p.case_weight_lb,
    qb_price: p.qb_price, skip_reason: '',
  })
}

// ── Report ───────────────────────────────────────────────────────────────────

const now = new Date()
const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
const outPath = path.join(ROOT, 'data', `qb-product-create-plan-${stamp}-from-fill.csv`)
const cols = Object.keys(out[0] ?? {}) as (keyof Out)[]
const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
fs.writeFileSync(outPath, [cols.join(','), ...out.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n') + '\n')

const by = (k: keyof Out, rows = out) => {
  const m = new Map<string, number>()
  for (const r of rows) for (const part of String(r[k] || '(none)').split('; ')) m.set(part, (m.get(part) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k2, v]) => `${k2}: ${v}`).join(' | ')
}
console.log(`sheet: ${path.relative(ROOT, FILE!)}  (${sheet.length} rows)\nplan:  ${path.relative(ROOT, PLAN!)}\n`)
console.log('=== Fill-sheet import (DRY RUN -- nothing written anywhere) ===')
console.log(`status: ${by('status')}`)
console.log(`incomplete rows need: ${by('needs', out.filter((r) => r.status === 'incomplete'))}`)
const errs = out.filter((r) => r.status === 'error')
console.log(`\nerrors (${errs.length}):`)
for (const r of errs) console.log(`  ${r.planned_sku.padEnd(16)} ${r.source.padEnd(12)} ${r.problems}`)
const ready = out.filter((r) => r.status === 'ready')
console.log(`\nready to create (${ready.length}):`)
for (const r of ready) console.log(`  ${r.planned_sku.padEnd(16)} ${r.final_name}  [${r.catalog_category} / Erply ${r.erply_group_name} #${r.erply_group_id}]${r.photo_files ? '' : '  NO PHOTO'}`)
console.log(`\nCSV: ${path.relative(ROOT, outPath)}`)
// TODO(--apply): not implemented. Feed the "ready" rows to the same apply
// steps listed at the bottom of scripts/create-products-from-qb.ts.
