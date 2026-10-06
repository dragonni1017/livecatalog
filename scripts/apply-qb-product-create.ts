// apply-qb-product-create.ts
// Run with: node scripts/apply-qb-product-create.ts                         (dry run)
//           node scripts/apply-qb-product-create.ts --only=F288023-VLT      (one SKU; comma list ok)
//           node scripts/apply-qb-product-create.ts --limit=1 --apply       (first ready row only)
//           node scripts/apply-qb-product-create.ts --apply
//           node scripts/apply-qb-product-create.ts --file=data/qb-product-create-plan-20261001-from-fill.csv
//
// The --apply step of the QuickBooks product-create flow. The chain is:
//   1. scripts/create-products-from-qb.ts        plan CSV           (dry run)
//   2. scripts/build-qb-product-fill-sheet.ts    fill-in xlsx       (a human fills it)
//   3. scripts/import-qb-product-fill-sheet.ts   ...-from-fill.csv  (validates, dry run)
//   4. THIS SCRIPT                               creates the "ready" rows
// See docs/memory/project-qb-product-create-plan-20261001.md.
//
// It reads ONLY rows the importer marked `ready` and does no planning of its
// own: name, category, Erply group and carton figures come from the CSV as
// the importer wrote them. Per SKU, in order:
//
//   a. Erply saveProduct through lib/erply.ts createErplyProduct (code, name,
//      groupID, status ACTIVE). No price: Erply discards it on this account
//      (proven 2026-09-16), so 0 is sent and the product is priced by hand in
//      Erply afterwards. No code2: qb_item_directory holds no barcode.
//      The live absence check (default statuses AND ARCHIVED) is re-run
//      IMMEDIATELY before each create, not just once up front -- a fast
//      double-submit produced a duplicate Erply product before (F288132,
//      2026-09-23).
//   b. Read the product back by code. Expect exactly one, our name, our
//      group, price 0.
//   c. Catalog insert, ONE row per call, WITHOUT `id` (products_id_seq
//      supplies it, 0020/0052), hidden at $0 -- a visible $0 product is
//      orderable (project-receiving-to-catalog-20260923.md). Single-row
//      inserts mean no union-of-keys NULLs (CLAUDE.md) and no chunk taking
//      other rows down with it. A products_pkey collision means the sequence
//      has fallen behind hand-assigned ids: the script STOPS and says to
//      re-run 0052; nothing else is affected because these are inserts.
//
// Resumable: a SKU already in Erply (ACTIVE, exactly our name) but missing
// from the catalog is treated as a previous run that died between (a) and
// (c), and only gets its catalog row. Any other existing SKU is skipped.
//
// Every write is appended to data/qb-product-create-applied-<YYYYMMDD>.csv
// as it happens, so a crash still leaves the record.
//
// Never writes WooCommerce (Erply's integration owns that) and never uploads
// photos: it prints the scripts/upload-container-photos.ts commands to run
// next, because a photo matched to a different SKU (the T642208 case) needs
// a human first.
//
// After it runs, the new products show on /admin/cleanup?issue=pricing under
// "Price in Erply". They are NOT in the "Ready to show" cohort, nor in
// zero-price-visibility.mjs --unhide's default cohort (both are receiving-
// only), so the NEXT block prints an --include-sku list for them.
//
// Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//                         ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { auditProductName } from '../lib/product-naming.ts'
import { implausibleCaseMeasurement } from '../lib/measurements.ts'
import { createErplyProduct, getErplyProductGroups } from '../lib/erply.ts'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })

const APPLY = process.argv.includes('--apply')
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3).replace(/^"|"$/g, '')
const ONLY = arg('only') ? new Set(arg('only')!.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)) : null
const LIMIT = arg('limit') ? Number(arg('limit')) : null
if (LIMIT != null && !(Number.isInteger(LIMIT) && LIMIT > 0)) { console.error('--limit must be a positive whole number'); process.exit(1) }

const CC = process.env.ERPLY_CLIENT_CODE
const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
for (const [name, val] of Object.entries({
  ERPLY_CLIENT_CODE: CC,
  ERPLY_USERNAME: process.env.ERPLY_USERNAME,
  ERPLY_PASSWORD: process.env.ERPLY_PASSWORD,
  NEXT_PUBLIC_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
})) {
  if (!val) { console.error(`Missing in .env.local: ${name}`); process.exit(1) }
}
const db = createClient(NEXT_PUBLIC_SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!)

// ── Inputs ───────────────────────────────────────────────────────────────────

const DATA = path.join(ROOT, 'data')
const newest = (re: RegExp) => {
  const f = fs.readdirSync(DATA).filter((n) => re.test(n)).sort().pop()
  return f ? path.join(DATA, f) : null
}
const FILE = arg('file') ? path.resolve(ROOT, arg('file')!) : newest(/^qb-product-create-plan-\d{8}-from-fill\.csv$/)
if (!FILE || !fs.existsSync(FILE)) { console.error('No ...-from-fill.csv found. Run scripts/import-qb-product-fill-sheet.ts first.'); process.exit(1) }

// The fill CSV is a snapshot of the sheet. If the sheet was edited after it,
// the CSV is stale and would create products from the old answers.
const SHEET = newest(/^qb-product-fill-in-\d{8}\.xlsx$/)
if (SHEET && fs.statSync(SHEET).mtimeMs > fs.statSync(FILE).mtimeMs) {
  console.error(`${path.relative(ROOT, SHEET)} was saved after ${path.relative(ROOT, FILE)}.\nRe-run scripts/import-qb-product-fill-sheet.ts so this works from the current sheet.`)
  process.exit(1)
}
// photo_dir lives only in the planner's CSV; used for the photo commands at the end.
const PLAN = newest(/^qb-product-create-plan-\d{8}\.csv$/)

type Row = Record<string, string>
const readCsv = (f: string): Row[] => {
  const wb = XLSX.readFile(f, { raw: true })
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: true })
    .map((r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v ?? '').trim()])))
}
const all = readCsv(FILE)
const photoDirBySku = new Map(PLAN ? readCsv(PLAN).filter((r) => r.planned_sku).map((r) => [r.planned_sku.toUpperCase(), r.photo_dir]) : [])

let rows = all.filter((r) => r.status === 'ready')
if (ONLY) {
  const unknown = [...ONLY].filter((s) => !all.some((r) => r.planned_sku.toUpperCase() === s))
  if (unknown.length) { console.error(`--only SKU(s) not in ${path.basename(FILE)}: ${unknown.join(', ')}`); process.exit(1) }
  const notReady = all.filter((r) => ONLY.has(r.planned_sku.toUpperCase()) && r.status !== 'ready')
  if (notReady.length) { console.error(`--only SKU(s) not ready: ${notReady.map((r) => `${r.planned_sku} (${r.status})`).join(', ')}`); process.exit(1) }
  rows = rows.filter((r) => ONLY.has(r.planned_sku.toUpperCase()))
}
if (LIMIT != null) rows = rows.slice(0, LIMIT)

const statusCounts = new Map<string, number>()
for (const r of all) statusCounts.set(r.status, (statusCounts.get(r.status) ?? 0) + 1)
console.log(`input: ${path.relative(ROOT, FILE)}  (${[...statusCounts].map(([k, v]) => `${k} ${v}`).join(', ')})`)
console.log(`mode:  ${APPLY ? 'APPLY -- writes to Erply and Supabase' : 'DRY RUN -- nothing written'}\n`)
if (rows.length === 0) { console.log('No ready rows to create.'); process.exit(0) }

// ── Erply reads (writes go through lib/erply.ts only) ─────────────────────────

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

interface ErplyProduct { productID: number; code: string; name: string; groupID?: number; status?: string; price?: number }
/** Exact code lookup across default statuses AND archived. Throws rather than guess on a failed read. */
async function erplyByCode(code: string): Promise<ErplyProduct[]> {
  const hits: ErplyProduct[] = []
  for (const extra of [{}, { status: 'ARCHIVED' }] as Record<string, string>[]) {
    const d = await erplyRead({ request: 'getProducts', sessionKey, code, ...extra })
    for (const r of (d.records ?? []) as ErplyProduct[]) {
      if (String(r.code ?? '').trim().toUpperCase() === code.toUpperCase() && !hits.some((h) => h.productID === r.productID)) hits.push(r)
    }
  }
  return hits
}
async function catalogBySku(sku: string) {
  // ilike with no wildcards = case-insensitive exact; escape the two that are.
  const { data, error } = await db.from('products').select('id, sku, name').ilike('sku', sku.replace(/[%_\\]/g, '\\$&'))
  if (error) throw new Error(`catalog lookup ${sku}: ${error.message}`)
  return data ?? []
}

// ── Pre-flight: validate the whole batch before writing anything ─────────────
// A product created in Erply cannot be un-created from this repo, so a batch
// that would fail halfway should not start.

const groupIds = new Set((await getErplyProductGroups()).map((g) => String(g.id)))
if (groupIds.size === 0) { console.error('Erply returned no product groups. Nothing was changed.'); process.exit(1) }
const { data: cats, error: catErr } = await db.from('categories').select('id, name')
if (catErr) { console.error(`categories: ${catErr.message}`); process.exit(1) }
const catIds = new Set((cats ?? []).map((c: { id: string }) => String(c.id)))

const num = (s: string) => (s === '' ? null : Number(s))
const problems: string[] = []
const seen = new Set<string>()
for (const r of rows) {
  const sku = r.planned_sku
  if (seen.has(sku.toUpperCase())) problems.push(`${sku}: appears twice in the CSV`)
  seen.add(sku.toUpperCase())
  if (!r.final_name) problems.push(`${sku}: no final_name`)
  else {
    const audit = auditProductName(r.final_name)
    if (audit.issues.length) problems.push(`${sku}: name fails audit (${audit.issues.join(', ')}): "${r.final_name}"`)
  }
  if (!/^\d+$/.test(r.erply_group_id) || !groupIds.has(r.erply_group_id)) problems.push(`${sku}: Erply group "${r.erply_group_id}" (${r.erply_group_name}) does not exist in Erply`)
  if (!catIds.has(r.catalog_category_id)) problems.push(`${sku}: catalog category id "${r.catalog_category_id}" (${r.catalog_category}) does not exist`)
  const m = { case_length_in: num(r.case_length_in), case_width_in: num(r.case_width_in), case_height_in: num(r.case_height_in), case_weight_lb: num(r.case_weight_lb) }
  if (Object.values(m).some((v) => v != null && !(Number.isFinite(v) && v > 0))) problems.push(`${sku}: a carton figure is not a positive number`)
  else {
    const bad = implausibleCaseMeasurement(m)
    if (bad) problems.push(`${sku}: carton figures implausible (${bad})`)
  }
}
if (problems.length) {
  console.error(`Nothing was created -- fix these first (in the sheet, then re-run the importer):\n  ${problems.join('\n  ')}`)
  process.exit(1)
}

// ── Live state ───────────────────────────────────────────────────────────────

type Action = 'create' | 'resume' | 'skip'
const planned: { r: Row; action: Action; why: string; erplyId?: number }[] = []
for (const r of rows) {
  const sku = r.planned_sku
  const [hits, inCatalog] = [await erplyByCode(sku), await catalogBySku(sku)]
  if (inCatalog.length) planned.push({ r, action: 'skip', why: `already in catalog: ${inCatalog.map((c) => `${c.sku} ${c.id}`).join(', ')}` })
  else if (hits.length === 0) planned.push({ r, action: 'create', why: '' })
  else if (hits.length === 1 && hits[0].status !== 'ARCHIVED' && hits[0].name === r.final_name) {
    planned.push({ r, action: 'resume', why: `in Erply as #${hits[0].productID} with this exact name, not in catalog`, erplyId: hits[0].productID })
  } else planned.push({ r, action: 'skip', why: `already in Erply: ${hits.map((h) => `${h.code} #${h.productID} ${h.status ?? ''} "${h.name}"`).join(', ')}` })
}

for (const p of planned) {
  const r = p.r
  const dims = r.case_length_in || r.case_weight_lb ? `  {${r.case_length_in || '-'}x${r.case_width_in || '-'}x${r.case_height_in || '-'} ${r.case_weight_lb || '-'}lb}` : ''
  console.log(`  [${p.action.padEnd(6)}] ${r.planned_sku.padEnd(16)} ${r.final_name}  [${r.catalog_category} / Erply #${r.erply_group_id}]${dims}${r.photo_files ? '' : '  NO PHOTO'}${p.why ? `\n${' '.repeat(28)}${p.why}` : ''}`)
}
const todo = planned.filter((p) => p.action !== 'skip')
console.log(`\n${planned.filter((p) => p.action === 'create').length} to create, ${planned.filter((p) => p.action === 'resume').length} to resume (catalog only), ${planned.length - todo.length} skipped.`)
if (!APPLY) { console.log('\nDry run -- nothing written. Re-run with --apply (try --limit=1 first).'); process.exit(0) }
if (todo.length === 0) process.exit(0)

// ── Apply ────────────────────────────────────────────────────────────────────

const now = new Date()
const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
const logPath = path.join(DATA, `qb-product-create-applied-${stamp}.csv`)
const LOG_COLS = ['at', 'sku', 'step', 'result', 'erply_product_id', 'catalog_id', 'name', 'detail']
const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
if (!fs.existsSync(logPath)) fs.writeFileSync(logPath, LOG_COLS.join(',') + '\n')
const log = (e: Record<string, unknown>) => fs.appendFileSync(logPath, LOG_COLS.map((c) => esc(c === 'at' ? new Date().toISOString() : e[c])).join(',') + '\n')

const done: { sku: string; erplyId: number; catalogId: string; warning: string }[] = []
const failed: { sku: string; error: string }[] = []
let stopped = ''

for (const p of todo) {
  const r = p.r
  const sku = r.planned_sku
  let erplyId = p.erplyId
  let warning = ''

  if (p.action === 'create') {
    // Re-check right before the one-way write.
    const hits = await erplyByCode(sku)
    if (hits.length) {
      const why = `appeared in Erply since the check above: ${hits.map((h) => `#${h.productID} ${h.status ?? ''}`).join(', ')}`
      log({ sku, step: 'erply', result: 'skipped', name: r.final_name, detail: why }); failed.push({ sku, error: why }); continue
    }
    try {
      erplyId = (await createErplyProduct({ sku, name: r.final_name, groupId: Number(r.erply_group_id), priceDollars: 0 })).productId
    } catch (err) {
      const msg = (err as Error).message
      log({ sku, step: 'erply', result: 'error', name: r.final_name, detail: msg }); failed.push({ sku, error: `Erply create: ${msg}` }); continue
    }
    // Read back before declaring success.
    const back = await erplyByCode(sku)
    const mine = back.find((h) => h.productID === erplyId)
    const issues: string[] = []
    if (back.length !== 1) issues.push(`${back.length} Erply products now carry this code`)
    if (!mine) issues.push('read-back did not find the new productID')
    else {
      if (mine.name !== r.final_name) issues.push(`Erply stored name "${mine.name}"`)
      if (String(mine.groupID) !== r.erply_group_id) issues.push(`Erply stored group ${mine.groupID}`)
      if ((mine.price ?? 0) !== 0) issues.push(`Erply stored price ${mine.price}`)
    }
    warning = issues.join('; ')
    log({ sku, step: 'erply', result: warning ? 'created-with-warning' : 'created', erply_product_id: erplyId, name: r.final_name, detail: warning })
  }

  const hasCase = [r.case_length_in, r.case_width_in, r.case_height_in, r.case_weight_lb].some(Boolean)
  const { data, error } = await db.from('products').insert({
    // NO `id`: products.id defaults from products_id_seq (0020/0052).
    sku, barcode: null, name: r.final_name, description: null,
    price_cents: 0, stock_qty: 0, is_active: true,
    manually_hidden: true, // a visible $0 product is orderable
    needs_photo: true,     // scripts/upload-container-photos.ts clears this
    category_id: r.catalog_category_id, image_url: null, image_urls: [],
    case_length_in: num(r.case_length_in), case_width_in: num(r.case_width_in),
    case_height_in: num(r.case_height_in), case_weight_lb: num(r.case_weight_lb),
    // 'manual' + updated_by, the P257281 precedent: keeps the Erply backfill
    // off figures that came from the QuickBooks description.
    measurements_source: hasCase ? 'manual' : null,
    measurements_updated_by: hasCase ? `qb-desc:${sku}` : null,
    measurements_updated_at: hasCase ? new Date().toISOString() : null,
  }).select('id').single()
  if (error) {
    log({ sku, step: 'catalog', result: 'error', erply_product_id: erplyId, name: r.final_name, detail: error.message })
    failed.push({ sku, error: `catalog insert: ${error.message}${erplyId ? ` (Erply #${erplyId} WAS created; a re-run resumes it)` : ''}` })
    if (/products_pkey/.test(error.message)) {
      stopped = 'products_pkey collision: products_id_seq is behind a hand-assigned id. Re-run supabase/migrations/0052_products_id_seq_reseed.sql in the SQL editor, then re-run this script -- it resumes.'
      break
    }
    continue
  }
  log({ sku, step: 'catalog', result: 'inserted', erply_product_id: erplyId, catalog_id: data.id, name: r.final_name })
  done.push({ sku, erplyId: erplyId!, catalogId: data.id, warning })
  console.log(`  ok ${sku.padEnd(16)} Erply #${erplyId}  catalog ${data.id}${warning ? `  WARNING: ${warning}` : ''}`)
}

// ── Report ───────────────────────────────────────────────────────────────────

if (done.length) {
  const { data: after } = await db.from('products')
    .select('sku, price_cents, manually_hidden, is_active, category_id')
    .in('sku', done.map((d) => d.sku))
  const a = after ?? []
  console.log(`\nRead back ${a.length}/${done.length} catalog rows: hidden ${a.filter((x) => x.manually_hidden).length}, at $0 ${a.filter((x) => x.price_cents === 0).length}, with category ${a.filter((x) => x.category_id).length}`)
}
console.log(`\nCreated ${done.length}, failed ${failed.length}.  Log: ${path.relative(ROOT, logPath)}`)
for (const f of failed) console.log(`  FAILED ${f.sku}: ${f.error}`)
const warned = done.filter((d) => d.warning)
for (const w of warned) console.log(`  CHECK  ${w.sku}: ${w.warning}`)
if (stopped) console.log(`\nSTOPPED: ${stopped}`)

if (done.length) {
  // Photos: upload-container-photos.ts matches by exact file name, so a row
  // whose photo is named for another SKU (an ambiguous family the sheet
  // resolved, e.g. T642208.jpg kept as T642208-tumbler) needs a human.
  const stem = (f: string) => f.replace(/\.[^.]+$/, '').replace(/ \(\d+\)$/, '').toUpperCase()
  const dirs = new Set<string>()
  const manual: string[] = []
  const none: string[] = []
  for (const d of done) {
    const r = rows.find((x) => x.planned_sku === d.sku)!
    const files = r.photo_files.split(/\s+/).filter(Boolean)
    if (!files.length) { none.push(d.sku); continue }
    if (!files.some((f) => stem(f) === d.sku.toUpperCase() || stem(f).replace(/-\d+$/, '') === d.sku.toUpperCase())) manual.push(`${d.sku} <- ${files.join(' ')}`)
    const dir = photoDirBySku.get(d.sku.toUpperCase())
    if (dir) dirs.add(dir)
  }
  console.log('\nNEXT:')
  console.log('  1. Price these in Erply by hand, then /admin/cleanup?issue=pricing -> "Pull prices from Erply now".')
  console.log('  2. Photos (dry run first; drop it for --apply):')
  for (const dir of dirs) console.log(`       node scripts/upload-container-photos.ts --dir="${dir}"`)
  if (manual.length) console.log(`     Photo named for a different SKU -- upload by hand:\n       ${manual.join('\n       ')}`)
  if (none.length) console.log(`     No photo on disk: ${none.join(', ')}`)
  console.log(`  3. Unhide once priced (dry run first; not in the receiving cohort, hence --include-sku):\n       node scripts/zero-price-visibility.mjs --unhide --include-sku=${done.map((d) => d.sku).join(',')}`)
}
process.exit(failed.length || stopped ? 1 : 0)
