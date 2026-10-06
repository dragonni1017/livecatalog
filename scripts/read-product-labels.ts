// read-product-labels.ts
// Run with: node scripts/read-product-labels.ts                          (preview: what would be read, est. cost)
//           node scripts/read-product-labels.ts --run                    (fill-sheet mode: read + write suggestions)
//           node scripts/read-product-labels.ts --run --only=K229532,S162819
//           node scripts/read-product-labels.ts --run --limit=10
//           node scripts/read-product-labels.ts --run --dir="C:/Users/Dragon/Downloads/New Photos"   (any folder)
//
// Reads the L&Y label printed on a product photo (SKU, UPC, item size,
// "12/bag", "20bags/cs", "240/cs" ...) with Claude vision, so pack facts and
// categories don't have to be typed in by hand. Two modes:
//
//   FILL-SHEET (default): for every row of the newest
//     data/qb-product-fill-in-<YYYYMMDD>.xlsx that still needs a pack spec or
//     category and has a photo, reads the label and writes a COPY,
//     data/qb-product-fill-in-<YYYYMMDD>-labels.xlsx, with suggestions filled
//     into blank cells and a "LABEL: ..." note on every row it looked at. The
//     original sheet is never touched, and the copy's name does not match the
//     importer's default pattern -- review it, then import it explicitly:
//       node scripts/import-qb-product-fill-sheet.ts --file=data/qb-product-fill-in-<date>-labels.xlsx
//   --dir=<folder>: any folder of label photos (e.g. a new container). Writes
//     only the readings CSV -- SKU, UPC, pack and case facts per photo.
//
// Both write data/label-readings-<YYYYMMDD>.csv. Nothing is written to Erply,
// Supabase, WooCommerce or Cloudinary.
//
// What gets filled, and the rules that keep it honest (a human still reviews):
//   - Pack spec only when the LABEL gives it: per-pack AND per-case figures
//     that multiply out ("12/bag 20bags/cs 240/cs"), or a per-pack figure that
//     divides the per-case one ("12pc/box 288pcs/cs" -> 24 boxes). A count
//     printed on the display box in the photo (the 3D egg box's "48PCS") is
//     used only when it divides the label's per-case count, and the note says
//     "inferred from packaging".
//   - A label that disagrees with the QuickBooks desc is a CONFLICT: nothing is
//     filled for that row, the note says why. QuickBooks is the source of
//     truth for new products (project-qb-item-pull.md), so the fix is in QB --
//     but the label is usually right (K229497 "40pc/cs" vs the label's 240).
//   - Sold by: the label never says. When a pack spec is filled, it takes the
//     category's own majority convention among existing catalog products, and
//     the note shows the count it came from.
//   - Category: Claude picks from the live catalog category list; filled only
//     where the cell is blank.
//   - A cell a human already filled is never overwritten.
//
// Cost: each photo is one Claude Opus 5.5 call (resized to 1600px, low
// effort). Every reading is cached in data/label-readings-cache.json by file
// hash, so a re-run only pays for new or changed photos. The preview prints
// an estimate; --run prints the real token cost at the end.
//
// Requires in .env.local: ANTHROPIC_API_KEY (or an `ant auth login` profile),
//   plus NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (category list).

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import Anthropic from '@anthropic-ai/sdk'
import sharp from 'sharp'
import { z } from 'zod'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })

const RUN = process.argv.includes('--run')
const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3).replace(/^"|"$/g, '')
const ONLY = arg('only') ? new Set(arg('only')!.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)) : null
const LIMIT = arg('limit') ? Number(arg('limit')) : null
const DIR = arg('dir')
const PHOTO_ROOT = arg('root') ?? 'C:/Users/Dragon/Downloads' // the planner's --root
const CONCURRENCY = 4

const MODEL = 'claude-opus-5-5'
const PRICE_IN = 4 / 1e6   // $ per input token, claude-opus-5-5 (2026-09)
const PRICE_OUT = 20 / 1e6 // $ per output token
const LONG_EDGE = 1600     // label text stays legible; ~3.4k image tokens
const EST_TOKENS_IN = 3800, EST_TOKENS_OUT = 700 // per photo, for the preview only

const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env
if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) { console.error('Missing in .env.local: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
const db = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

const DATA = path.join(ROOT, 'data')
const now = new Date()
const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
const newest = (re: RegExp) => {
  const f = fs.readdirSync(DATA).filter((n) => re.test(n)).sort().pop()
  return f ? path.join(DATA, f) : null
}
const text = (v: unknown) => (v == null ? '' : String(v).trim())

// ── Categories and their sold-by conventions (live) ──────────────────────────

const { data: catRows, error: catErr } = await db.from('categories').select('id, name').order('name')
if (catErr) { console.error(`categories: ${catErr.message}`); process.exit(1) }
const categories = (catRows ?? []) as { id: string; name: string }[]
const CATEGORY_NAMES = categories.map((c) => c.name).filter((n) => n !== 'New Arrivals')

/** Majority sold_by among active products in a category whose name has a pack spec. */
const soldByCache = new Map<string, { soldBy: 'piece' | 'pack'; n: number; of: number } | null>()
async function soldByConvention(catName: string) {
  if (soldByCache.has(catName)) return soldByCache.get(catName)!
  const cat = categories.find((c) => c.name === catName)
  let result: { soldBy: 'piece' | 'pack'; n: number; of: number } | null = null
  if (cat) {
    const { data } = await db.from('products').select('sold_by').eq('category_id', cat.id).eq('is_active', true).not('sold_by', 'is', null).limit(2000)
    const rows = (data ?? []) as { sold_by: string }[]
    const piece = rows.filter((r) => r.sold_by === 'piece').length
    const pack = rows.filter((r) => r.sold_by === 'pack').length
    if (piece + pack >= 5) result = piece >= pack ? { soldBy: 'piece', n: piece, of: piece + pack } : { soldBy: 'pack', n: pack, of: piece + pack }
  }
  soldByCache.set(catName, result)
  return result
}

// ── The label reading ────────────────────────────────────────────────────────

const intOrNull = { anyOf: [{ type: 'integer' }, { type: 'null' }] }
const strOrNull = { anyOf: [{ type: 'string' }, { type: 'null' }] }
const LABEL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['has_label', 'label_text', 'sku', 'upc', 'item_size', 'per_pack_qty', 'per_pack_unit', 'packs_per_case', 'pieces_per_case',
    'case_count_unit', 'set_piece_count', 'packaging_count', 'suggested_category', 'notes'],
  properties: {
    has_label: { type: 'boolean', description: 'true if the photo carries an L&Y USA product label block' },
    label_text: { ...strOrNull, description: 'the label block transcribed exactly, lines joined with " | "' },
    sku: { ...strOrNull, description: 'item number exactly as printed, e.g. "K229532" or "P273796-25cm"' },
    upc: { ...strOrNull, description: 'UPC digits exactly as printed, no spaces' },
    item_size: { ...strOrNull, description: 'item dimension line(s) as printed, e.g. "2\\" x 0.98\\" x 3.54\\""' },
    per_pack_qty: { ...intOrNull, description: 'pieces in one inner pack, from a line like "12/bag", "6/box", "12pc/box"; null if not printed' },
    per_pack_unit: { ...strOrNull, description: 'the inner pack word as printed: bag, box, pk, set, ...' },
    packs_per_case: { ...intOrNull, description: 'inner packs per case, from "20bags/cs", "6bxs/cs"; null if not printed' },
    pieces_per_case: { ...intOrNull, description: 'the total per case, from "240/cs", "192pcs/cs", "12sets/cs"; null if not printed' },
    case_count_unit: { ...strOrNull, description: 'what pieces_per_case counts as printed: pcs, sets, pk ... (null if just "N/cs")' },
    set_piece_count: { ...intOrNull, description: 'if the label lists the sizes/pieces of a set (S, M, L, ...), how many are listed' },
    packaging_count: { ...intOrNull, description: 'a count printed on the display box or packaging in the photo (NOT the label), e.g. "48PCS"; null if none' },
    suggested_category: { anyOf: [{ type: 'string', enum: CATEGORY_NAMES }, { type: 'null' }], description: 'best catalog category for this product' },
    notes: { ...strOrNull, description: 'anything a buyer would flag: unreadable text, several products in one photo, a size list that contradicts a set count, ...' },
  },
} as const

const Reading = z.object({
  has_label: z.boolean(), label_text: z.string().nullable(), sku: z.string().nullable(), upc: z.string().nullable(),
  item_size: z.string().nullable(), per_pack_qty: z.number().int().nullable(), per_pack_unit: z.string().nullable(),
  packs_per_case: z.number().int().nullable(), pieces_per_case: z.number().int().nullable(), case_count_unit: z.string().nullable(),
  set_piece_count: z.number().int().nullable(), packaging_count: z.number().int().nullable(),
  suggested_category: z.string().nullable(), notes: z.string().nullable(),
})
type Reading = z.infer<typeof Reading>

const SYSTEM = `You read product label photos for L&Y USA, a wholesale gift and floral supplier.
Each photo shows the product and a printed label block: the L&Y USA logo, then lines such as the item number, "UPC:...", item dimensions, and packing lines like "12/bag", "20bags/cs", "240/cs".
Transcribe what is printed. Never infer a packing figure the label does not print: if the label only says "240/cs", per_pack_qty and packs_per_case are null.
A count printed on the product's own packaging (e.g. "48PCS" on a display box) goes in packaging_count, never in the label fields.
For the category, pick the closest match from the allowed list based on what the product is.`

const cachePath = path.join(DATA, 'label-readings-cache.json')
const cache: Record<string, Reading> = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {}
const saveCache = () => fs.writeFileSync(cachePath, JSON.stringify(cache, null, 1))

let client: Anthropic | null = null
let tokensIn = 0, tokensOut = 0

async function readLabel(file: string): Promise<{ reading?: Reading; cached?: boolean; error?: string }> {
  const buf = fs.readFileSync(file)
  const key = `${MODEL}:${crypto.createHash('sha1').update(buf).digest('hex')}`
  if (cache[key]) return { reading: cache[key], cached: true }
  const jpeg = await sharp(buf).rotate().resize(LONG_EDGE, LONG_EDGE, { fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }).jpeg({ quality: 88 }).toBuffer()
  client ??= new Anthropic()
  try {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      // Refusals are very unlikely on label photos; this routes one to a
      // fallback model instead of losing the row.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: LABEL_SCHEMA } },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } },
          { type: 'text', text: `File name: ${path.basename(file)}. Read the label.` },
        ],
      }],
    } as Anthropic.Beta.MessageCreateParamsNonStreaming)
    tokensIn += res.usage.input_tokens ?? 0
    tokensOut += res.usage.output_tokens ?? 0
    if (res.stop_reason === 'refusal') return { error: `refused (${res.stop_details?.category ?? 'no category'})` }
    if (res.stop_reason === 'max_tokens') return { error: 'hit max_tokens' }
    const out = res.content.find((b) => b.type === 'text')
    if (!out || out.type !== 'text') return { error: 'no text block in the response' }
    const parsed = Reading.safeParse(JSON.parse(out.text))
    if (!parsed.success) return { error: `unexpected shape: ${parsed.error.message.slice(0, 120)}` }
    cache[key] = parsed.data
    saveCache()
    return { reading: parsed.data }
  } catch (err) {
    // No key at all surfaces as a plain Error from the SDK's credential
    // lookup, not an AuthenticationError -- stop on either, before every
    // photo fails the same way.
    if (err instanceof Anthropic.AuthenticationError || (!(err instanceof Anthropic.APIError) && /credential/i.test((err as Error).message))) {
      console.error('\nNo usable Anthropic credentials. Add ANTHROPIC_API_KEY to .env.local (or run `ant auth login`), then re-run.')
      process.exit(1)
    }
    if (err instanceof Anthropic.RateLimitError) return { error: 'rate limited (the SDK already retried) -- re-run later; cached rows are kept' }
    if (err instanceof Anthropic.APIError) return { error: `API ${err.status}: ${err.message.slice(0, 160)}` }
    return { error: (err as Error).message }
  }
}

/** Run fn over items, CONCURRENCY at a time, preserving order. */
async function pool<T, R>(items: T[], fn: (t: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i) }
  }))
  return out
}

// ── Work list ────────────────────────────────────────────────────────────────

interface Job { sku: string; file: string; row?: Record<string, unknown>; plan?: Record<string, string> }
const IMG = /\.(jpe?g|png|webp)$/i
let jobs: Job[] = []
let sheetFile: string | null = null
let sheetWb: any = null
let sheetRows: Record<string, unknown>[] = []
let sheetHeader: string[] = []

if (DIR) {
  const dir = path.resolve(DIR)
  if (!fs.existsSync(dir)) { console.error(`No such folder: ${dir}`); process.exit(1) }
  jobs = fs.readdirSync(dir).filter((n) => IMG.test(n)).sort().map((n) => ({ sku: n.replace(/\.[^.]+$/, ''), file: path.join(dir, n) }))
} else {
  sheetFile = newest(/^qb-product-fill-in-\d{8}\.xlsx$/)
  const planFile = newest(/^qb-product-create-plan-\d{8}\.csv$/)
  if (!sheetFile || !planFile) { console.error('No fill sheet / plan CSV in data/. Run build-qb-product-fill-sheet.ts first, or pass --dir=.'); process.exit(1) }
  sheetWb = XLSX.readFile(sheetFile)
  sheetRows = XLSX.utils.sheet_to_json(sheetWb.Sheets['Fill In'], { defval: '' })
  sheetHeader = Object.keys(sheetRows[0] ?? {})
  const planWb = XLSX.readFile(planFile, { raw: true })
  const plan: Record<string, string>[] = XLSX.utils.sheet_to_json(planWb.Sheets[planWb.SheetNames[0]], { defval: '', raw: true })
  const planBySku = new Map(plan.filter((r) => r.planned_sku).map((r) => [String(r.planned_sku).toUpperCase(), r]))
  const missingPhoto: string[] = []
  for (const row of sheetRows) {
    const sku = text(row.SKU)
    if (!sku || text(row['Skip (reason)'])) continue
    const needs = ['Pieces per pack', 'Packs (boxes) per case', 'Sold by (piece/pack)', 'Category'].some((h) => !text(row[h]))
    if (!needs) continue
    const p = planBySku.get(sku.toUpperCase())
    const files = text(row['Photo file(s)']).split(/\s+/).filter(Boolean)
    const dirs = text(p?.photo_dir).split(' | ').filter(Boolean).map((d) => path.resolve(PHOTO_ROOT, d))
    // The first listed file is the primary view; take the first that exists.
    const file = files.flatMap((f) => dirs.map((d) => path.join(d, f))).find((f) => fs.existsSync(f))
    if (!file) { if (files.length) missingPhoto.push(sku); continue }
    jobs.push({ sku, file, row, plan: p })
  }
  if (missingPhoto.length) console.log(`photo listed but not found on disk (skipped): ${missingPhoto.join(', ')}`)
}
if (ONLY) jobs = jobs.filter((j) => ONLY.has(j.sku.toUpperCase()))
if (LIMIT != null) jobs = jobs.slice(0, LIMIT)

const uncached = jobs.filter((j) => !cache[`${MODEL}:${crypto.createHash('sha1').update(fs.readFileSync(j.file)).digest('hex')}`]).length
console.log(`${DIR ? `folder: ${DIR}` : `sheet:  ${path.relative(ROOT, sheetFile!)}`}`)
console.log(`${jobs.length} photo(s) to read, ${jobs.length - uncached} already cached, ${uncached} new.`)
console.log(`estimated cost for the new ones: ~$${(uncached * (EST_TOKENS_IN * PRICE_IN + EST_TOKENS_OUT * PRICE_OUT)).toFixed(2)} (${MODEL})`)
if (!RUN) {
  for (const j of jobs.slice(0, 15)) console.log(`  ${j.sku.padEnd(16)} ${path.relative(PHOTO_ROOT, j.file)}`)
  if (jobs.length > 15) console.log(`  ... and ${jobs.length - 15} more`)
  console.log('\nPreview only -- nothing sent. Re-run with --run (try --limit=5 first).')
  process.exit(0)
}

// ── Read ─────────────────────────────────────────────────────────────────────

let done = 0
const results = await pool(jobs, async (j) => {
  const r = await readLabel(j.file)
  done++
  if (!r.cached) process.stdout.write(`\r  read ${done}/${jobs.length}`)
  return r
})
console.log('')

// ── Interpret against QuickBooks ─────────────────────────────────────────────

/** QB facts the importer enforces (plan CSV columns, written by the planner). */
function qbFacts(p?: Record<string, string>) {
  const num = (s: unknown) => (text(s) ? Number(s) : null)
  return {
    pk: num(p?.pieces_per_pack), bx: num(p?.packs_per_case), bxUnit: text(p?.packs_per_case_unit),
    cs: num(p?.pieces_per_case_stated), setCount: Number(text(p?.qb_desc).match(/(\d+)\s*-?\s*(?:piece|pc)\s+set/i)?.[1] ?? NaN) || null,
  }
}

interface Out { sku: string; file: string; status: string; reading?: Reading; pk?: number; bx?: number; soldBy?: string; category?: string; note: string }
const outs: Out[] = []
for (let i = 0; i < jobs.length; i++) {
  const j = jobs[i]
  const { reading: r, error } = results[i]
  const base: Out = { sku: j.sku, file: path.relative(PHOTO_ROOT, j.file), status: '', note: '' }
  if (error || !r) { outs.push({ ...base, status: 'error', note: `LABEL: not read (${error})` }); continue }
  base.reading = r
  if (!r.has_label) { outs.push({ ...base, status: 'no-label', note: 'LABEL: no L&Y label in this photo' }); continue }

  const said: string[] = []
  if (r.per_pack_qty) said.push(`${r.per_pack_qty}/${r.per_pack_unit ?? 'pk'}`)
  if (r.packs_per_case) said.push(`${r.packs_per_case} packs/cs`)
  if (r.pieces_per_case) said.push(`${r.pieces_per_case}${r.case_count_unit ? ' ' + r.case_count_unit : ''}/cs`)
  if (r.packaging_count) said.push(`packaging prints ${r.packaging_count}`)
  const conflicts: string[] = []
  if (r.sku && r.sku.toUpperCase() !== j.sku.toUpperCase()) conflicts.push(`label is for ${r.sku}, not ${j.sku}`)

  // Pack spec, from the label only.
  let pk: number | undefined, bx: number | undefined, how = ''
  const cs = r.pieces_per_case
  if (r.per_pack_qty && r.packs_per_case && (!cs || r.per_pack_qty * r.packs_per_case === cs)) { pk = r.per_pack_qty; bx = r.packs_per_case; how = 'label' }
  else if (r.per_pack_qty && cs && cs % r.per_pack_qty === 0 && cs > r.per_pack_qty) { pk = r.per_pack_qty; bx = cs / r.per_pack_qty; how = 'label (packs/case = case / pack)' }
  else if (r.per_pack_qty && r.packs_per_case && cs) conflicts.push(`label pack figures don't multiply out (${r.per_pack_qty} x ${r.packs_per_case} != ${cs})`)
  else if (!r.per_pack_qty && r.packaging_count && cs && cs % r.packaging_count === 0 && cs > r.packaging_count) { pk = r.packaging_count; bx = cs / r.packaging_count; how = 'INFERRED from packaging print' }
  else if (/sets?/i.test(r.case_count_unit ?? '') && cs) { pk = 1; bx = cs; how = 'label (sold as sets)' }

  // Against QuickBooks (fill-sheet mode only): mirror the importer's checks.
  if (j.plan) {
    const q = qbFacts(j.plan)
    if (cs && q.cs && cs !== q.cs) conflicts.push(`label ${cs}/cs vs QB ${q.cs}/cs -- fix QB if the label is right`)
    if (cs && !q.cs && q.bx && !r.packs_per_case && /pcs?|pieces?/i.test(r.case_count_unit ?? '') && q.bxUnit !== 'bx') {
      conflicts.push(`label says ${cs} PIECES/cs, QB says ${q.bx} PACKS/cs`)
    }
    if (pk != null && q.pk != null && pk !== q.pk) conflicts.push(`pack ${pk} vs QB ${q.pk}/pk`)
    if (bx != null && q.bx != null && bx !== q.bx) conflicts.push(`packs/case ${bx} vs QB ${q.bx}`)
    if (r.set_piece_count && q.setCount && r.set_piece_count !== q.setCount) conflicts.push(`label lists ${r.set_piece_count} sizes, QB says ${q.setCount} Piece Set -- check the name`)
  }

  const category = r.suggested_category && CATEGORY_NAMES.includes(r.suggested_category) ? r.suggested_category : undefined
  const sheetCat = j.row ? text(j.row['Category']) : ''
  let soldBy: string | undefined
  let soldNote = ''
  if (!conflicts.length && pk != null) {
    const conv = await soldByConvention(sheetCat || category || '')
    if (conv) { soldBy = conv.soldBy; soldNote = `; sold-by from ${sheetCat || category} convention (${conv.n} of ${conv.of})` }
  }
  const status = conflicts.length ? 'conflict' : pk != null ? 'pack' : 'category-only'
  const note = `LABEL: ${said.join(', ') || 'no packing lines'}${r.upc ? `; UPC ${r.upc}` : ''}`
    + (conflicts.length ? ` -- CONFLICT: ${conflicts.join('; ')}; pack left blank` : pk != null ? ` -> ${pk}/pk ${bx}bx/cs (${how})${soldNote}` : ' -- no pack size on label')
    + (r.notes ? ` [${r.notes}]` : '')
  outs.push({ ...base, status, pk: conflicts.length ? undefined : pk, bx: conflicts.length ? undefined : bx, soldBy, category, note })
}

// ── Write ────────────────────────────────────────────────────────────────────

if (outs.length && outs.every((o) => o.status === 'error')) {
  console.error(`Every read failed, so nothing was written. First error: ${outs[0].note}`)
  process.exit(1)
}

const csvPath = path.join(DATA, `label-readings-${stamp}.csv`)
const COLS = ['sku', 'file', 'status', 'label_sku', 'upc', 'item_size', 'per_pack_qty', 'per_pack_unit', 'packs_per_case', 'pieces_per_case',
  'case_count_unit', 'set_piece_count', 'packaging_count', 'suggested_category', 'fill_pk', 'fill_bx', 'fill_sold_by', 'note', 'label_text']
const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
fs.writeFileSync(csvPath, [COLS.join(','), ...outs.map((o) => {
  const r = o.reading
  return [o.sku, o.file, o.status, r?.sku, r?.upc, r?.item_size, r?.per_pack_qty, r?.per_pack_unit, r?.packs_per_case, r?.pieces_per_case,
    r?.case_count_unit, r?.set_piece_count, r?.packaging_count, r?.suggested_category, o.pk, o.bx, o.soldBy, o.note, r?.label_text].map(esc).join(',')
})].join('\n') + '\n')

let sheetOut = ''
if (!DIR && sheetWb) {
  const filled = { pk: 0, bx: 0, soldBy: 0, category: 0 }
  const bySku = new Map(outs.map((o) => [o.sku.toUpperCase(), o]))
  for (const row of sheetRows) {
    const o = bySku.get(text(row.SKU).toUpperCase())
    if (!o) continue
    const put = (h: string, v: unknown, k: keyof typeof filled) => { if (v != null && v !== '' && !text(row[h])) { row[h] = v; filled[k]++ } }
    put('Pieces per pack', o.pk, 'pk')
    put('Packs (boxes) per case', o.bx, 'bx')
    put('Sold by (piece/pack)', o.soldBy, 'soldBy')
    put('Category', o.category, 'category')
    row['Notes'] = o.note + (text(row['Notes']) ? ` | ${text(row['Notes'])}` : '')
  }
  sheetWb.Sheets['Fill In'] = XLSX.utils.json_to_sheet(sheetRows, { header: sheetHeader })
  sheetOut = path.join(DATA, `${path.basename(sheetFile!, '.xlsx')}-labels.xlsx`)
  XLSX.writeFile(sheetWb, sheetOut)
  console.log(`filled into blank cells: pieces/pack ${filled.pk}, packs/case ${filled.bx}, sold by ${filled.soldBy}, category ${filled.category}`)
}

const count = (s: string) => outs.filter((o) => o.status === s).length
console.log(`\nread ${outs.length}: pack spec ${count('pack')}, category only ${count('category-only')}, CONFLICT ${count('conflict')}, no label ${count('no-label')}, error ${count('error')}`)
for (const o of outs.filter((x) => x.status === 'conflict' || x.status === 'error')) console.log(`  ${o.status.toUpperCase().padEnd(8)} ${o.sku.padEnd(16)} ${o.note}`)
console.log(`\nAPI cost this run: $${(tokensIn * PRICE_IN + tokensOut * PRICE_OUT).toFixed(2)} (${tokensIn} in / ${tokensOut} out tokens)`)
console.log(`readings: ${path.relative(ROOT, csvPath)}`)
if (sheetOut) {
  console.log(`sheet:    ${path.relative(ROOT, sheetOut)}  (the original is untouched)`)
  console.log(`\nReview the sheet, then: node scripts/import-qb-product-fill-sheet.ts --file=${path.relative(ROOT, sheetOut).replace(/\\/g, '/')}`)
}
