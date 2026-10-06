// create-products-from-qb.ts
// Run with: node scripts/create-products-from-qb.ts                 (dry run -- the only mode)
//           node scripts/create-products-from-qb.ts --only=T642200  (one photo SKU)
//           node scripts/create-products-from-qb.ts --root="C:/Users/Dragon/Downloads/New Photos"
//
// PLANS creating catalog + Erply products for SKUs that have photos on disk but
// exist in NEITHER Erply nor the catalog, using QuickBooks Desktop as the
// source of product info (docs/memory/project-local-photos-skus-not-in-erply.md,
// project-qb-item-pull.md). DRY RUN ONLY. Writes nothing to Erply,
// WooCommerce, Supabase or Cloudinary -- creating is
// scripts/apply-qb-product-create.ts (see the note at the bottom). Output: console summary + data/qb-product-create-plan-<YYYYMMDD>.csv.
//
// Input: data/local-photo-skus-qb-match-20261001.tsv (photo_sku, qb_sku, ...).
// The TSV's flattened description is NOT trusted: every row is re-read from
// qb_item_directory (migration 0050), including every QuickBooks item whose
// SKU is the photo SKU plus a "-suffix", because suffixed variants carrying
// different products under one base are normal on this account (F287759 vs
// F287759-FLOWER). The TSV is only the list of photo SKUs to look at.
//
// Per SKU, before planning anything, it RE-CHECKS live that the SKU (and the
// QuickBooks variant SKU, if different) is still absent from Erply
// (getProducts code=, default statuses and ARCHIVED) and from the catalog
// (case-insensitive). Containers get received over time; anything that now
// exists is reported and skipped.
//
// What gets planned, and the rules that keep it honest:
//
//  1. NAME, per lib/product-naming.ts. Carton dims/weight are stripped out of
//     the name. A pack spec is NEVER invented: QuickBooks usually states only
//     a case quantity ("48 pcs/cs") and no pieces-per-pack, so the name can't
//     carry a complete `pk/pk bx/cs cs.N`. Those rows are `needs_pack_spec`
//     and carry only what the description stated. A spec is built only when
//     the description itself gives both a per-pack figure and a per-case
//     figure, and the result must pass auditProductName cleanly.
//     ONE approved exception -- Dragon, 2026-10-01: a PLUSH whose desc states
//     only "N/cs" becomes "1/pk Nbx/cs cs.N" (sold singly). See plushRule().
//  2. CARTON MEASUREMENTS -> case_* (INCHES / POUNDS, migration 0045). Taken
//     only when the unit is unambiguous (`23" x 16" x 11" - 17 lbs`) or the
//     description matches the house pattern Dragon confirmed as inches for
//     P257281 on 2026-09-17 (`25x25x25 42lbs`: unitless dims + a weight in
//     lbs). cm / kg / unitless-without-lbs -> null and flagged, never
//     converted. Everything taken must pass implausibleCaseMeasurement.
//  3. PRICE: QuickBooks sales_price is reported for information only. Erply
//     cannot take a price over the API on this account (decided manual step,
//     2026-09-16), so the catalog row would go in HIDDEN at $0 -- a visible
//     $0 product is orderable (project-receiving-to-catalog-20260923.md).
//  4. CATEGORY: proposed only where it falls out deterministically -- every
//     existing Erply product with the same SKU letter-prefix within +/-10 of
//     the number is in ONE Erply group (min 2 neighbours). The catalog
//     category is then that group through resolveErplyCategoryAlias, exactly
//     as the receiving to-catalog route derives it. Anything else is blank
//     and flagged.
//  5. PAYLOADS: the Erply saveProduct a create would send (mirrors
//     lib/erply.ts createErplyProduct: code, name, groupID, status -- groupID
//     is required, receiving refuses a line without a category), and the
//     catalog insert. The catalog insert does NOT carry `id`: products.id's
//     default (products_id_seq, migration 0020/0052) assigns it.
//  6. PHOTOS: lib/photo-matching.ts + scripts/photo-files.ts over Downloads
//     with find-photos-for-missing-images.ts's SKIP dirs, plus the two June
//     SAMPLE folders (6-16-26pics, 6-17-26pics -- Dragon, 2026-10-01). A
//     bare-base photo is NEVER attached to a suffixed variant: those files
//     are listed as candidates for a human to confirm.
//
// Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//                         ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { auditProductName, normalizeDescriptor, formatPackSpec } from '../lib/product-naming.ts'
import { implausibleCaseMeasurement } from '../lib/measurements.ts'
import { resolveErplyCategoryAlias } from '../lib/erply-category-aliases.ts'
import { matchFilesToProducts } from '../lib/photo-matching.ts'
import { readImageFiles } from './photo-files.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })

if (process.argv.includes('--apply')) {
  console.error('This script only plans. Create products with scripts/apply-qb-product-create.ts (see the note at the bottom).')
  process.exit(1)
}
const onlyArg = process.argv.find((a) => a.startsWith('--only='))
const ONLY = onlyArg ? onlyArg.slice(7).trim().toUpperCase() : null
const rootArg = process.argv.find((a) => a.startsWith('--root='))
const SEARCH_ROOT = rootArg ? rootArg.slice(7).replace(/^"|"$/g, '') : 'C:/Users/Dragon/Downloads'
const INPUT_TSV = path.join(ROOT, 'data', 'local-photo-skus-qb-match-20261001.tsv')

// find-photos-for-missing-images.ts's list, plus the June sample folders.
const SKIP_DIRS = [
  'livecatalog', 'node_modules', '.git', '.next',
  '05_tools_and_scripts', '06_installers_optional_redownload',
  '03_design_files', '04_email_backup',
  '6-16-26pics', '6-17-26pics', // SAMPLES -- never create products from these
]

const CC = process.env.ERPLY_CLIENT_CODE
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
for (const [name, val] of Object.entries({
  ERPLY_CLIENT_CODE: CC,
  ERPLY_USERNAME: process.env.ERPLY_USERNAME,
  ERPLY_PASSWORD: process.env.ERPLY_PASSWORD,
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
})) {
  if (!val) { console.error(`Missing in .env.local: ${name}`); process.exit(1) }
}
const db = createClient(SUPABASE_URL!, SERVICE_KEY!)

// ── Erply (read-only calls only) ──────────────────────────────────────────────

const READ_ONLY_REQUESTS = new Set(['verifyUser', 'getProducts'])
async function erplyRead(params: Record<string, string>) {
  // Belt and braces: this script must never be able to send a write.
  if (!READ_ONLY_REQUESTS.has(params.request)) throw new Error(`refusing non-read Erply request ${params.request}`)
  const res = await fetch(`https://${CC}.erply.com/api/`, {
    method: 'POST',
    body: new URLSearchParams({ clientCode: CC!, ...params }),
  })
  if (!res.ok) throw new Error(`Erply HTTP ${res.status}`)
  const json = await res.json()
  if (json.status?.responseStatus === 'error') {
    throw new Error(`Erply error ${json.status.errorCode}: ${json.status.errorField ?? 'unknown'}`)
  }
  return json
}

interface ErplyProduct { productID: number; code: string; name: string; groupID?: number; groupName?: string; status?: string }

const auth = await erplyRead({ request: 'verifyUser', username: process.env.ERPLY_USERNAME!, password: process.env.ERPLY_PASSWORD! })
const sessionKey: string = auth.records[0].sessionKey

let archivedLookupError: string | null = null
/** Exact code lookup across default statuses and ARCHIVED. */
async function erplyByCode(code: string): Promise<ErplyProduct[]> {
  const hits: ErplyProduct[] = []
  for (const extra of [{}, { status: 'ARCHIVED' }] as Record<string, string>[]) {
    try {
      const d = await erplyRead({ request: 'getProducts', sessionKey, code, ...extra })
      for (const r of (d.records ?? []) as ErplyProduct[]) {
        if (String(r.code ?? '').trim().toUpperCase() === code.toUpperCase() && !hits.some((h) => h.productID === r.productID)) hits.push(r)
      }
    } catch (err) {
      if (!extra.status) throw err
      archivedLookupError = (err as Error).message
    }
  }
  return hits
}

async function erplyAll(): Promise<ErplyProduct[]> {
  const out: ErplyProduct[] = []
  for (let page = 1; ; page++) {
    const d = await erplyRead({ request: 'getProducts', sessionKey, recordsOnPage: '500', pageNo: String(page) })
    const recs = (d.records ?? []) as ErplyProduct[]
    out.push(...recs)
    if (recs.length === 0 || out.length >= (d.status?.recordsTotal ?? 0)) break
  }
  return out
}

// ── Supabase (selects only) ───────────────────────────────────────────────────

async function selectAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...((data ?? []) as T[]))
    if ((data ?? []).length < 1000) break
  }
  return out
}

interface QbRow { sku: string; full_name: string; sales_desc: string | null; item_type: string | null; sales_price: number | null; is_active: boolean | null }

// ── Description parsing ──────────────────────────────────────────────────────

const NUM = String.raw`(\d+(?:\.\d+)?)`
const DIM_UNIT = String.raw`\s*("|''|in(?:ch(?:es)?)?\b|cm\b|mm\b)?`
const DIMS_RE = new RegExp(`${NUM}${DIM_UNIT}\\s*[x×]\\s*${NUM}${DIM_UNIT}\\s*[x×]\\s*${NUM}${DIM_UNIT}`, 'i')
const WEIGHT_RE = new RegExp(`${NUM}\\s*(lbs?|pounds?|kgs?)\\b`, 'i')

interface Measured {
  case_length_in: number | null; case_width_in: number | null; case_height_in: number | null; case_weight_lb: number | null
  basis: string; flag: string
}

function parseMeasurements(text: string): { m: Measured; rest: string } {
  const empty: Measured = { case_length_in: null, case_width_in: null, case_height_in: null, case_weight_lb: null, basis: '', flag: '' }
  let rest = text
  const d = DIMS_RE.exec(rest)
  if (d) rest = rest.replace(d[0], ' ')
  const w = WEIGHT_RE.exec(rest)
  if (w) rest = rest.replace(w[0], ' ')
  if (!d && !w) return { m: { ...empty, flag: 'no carton figures in QB desc' }, rest }

  const units = d ? [d[2], d[4], d[6]].map((u) => (u ? (/cm|mm/i.test(u) ? 'metric' : 'in') : null)) : []
  const weightUnit = w ? (/kg/i.test(w[2]) ? 'kg' : 'lb') : null

  if (d && units.includes('metric')) return { m: { ...empty, flag: `metric dims "${d[0].trim()}" -- not converted (0045 is inches)` }, rest }
  if (weightUnit === 'kg') return { m: { ...empty, flag: `weight in kg "${w![0]}" -- not converted (0045 is pounds)` }, rest }

  const explicitIn = units.some((u) => u === 'in')
  const allUnitless = units.length > 0 && units.every((u) => u === null)
  let basis = ''
  if (d && explicitIn) basis = 'explicit inches'
  else if (d && allUnitless && weightUnit === 'lb') basis = 'unitless dims + lbs (house pattern, P257281 confirmed inches)'
  else if (d && allUnitless) return { m: { ...empty, flag: `unitless dims "${d[0].trim()}" with no lbs weight -- unit ambiguous` }, rest }

  const m: Measured = {
    case_length_in: d ? Number(d[1]) : null,
    case_width_in: d ? Number(d[3]) : null,
    case_height_in: d ? Number(d[5]) : null,
    case_weight_lb: w ? Number(w[1]) : null,
    basis: basis || (w ? 'weight only (lbs)' : ''),
    flag: '',
  }
  if (!d) m.flag = 'weight only, no dims'
  else if (!w) m.flag = 'dims only, no weight'
  const bad = implausibleCaseMeasurement(m)
  if (bad) return { m: { ...empty, flag: `implausible: ${bad}` }, rest }
  return { m, rest }
}

interface Pack { perPack: number | null; perCase: number | null; perCaseUnit: 'pk' | 'bx' | 'set' | null; piecesPerCase: number | null }

/** Pull every pack token out of the text. Order matters: N/bx/cs before N/bx. */
function parsePack(text: string): { pack: Pack; stated: string[]; rest: string } {
  const pack: Pack = { perPack: null, perCase: null, perCaseUnit: null, piecesPerCase: null }
  const stated: string[] = []
  let rest = text
  // `stated` is re-spelled in house shape ("48 pcs/cs" -> "48/cs", "150 pk's/cs"
  // -> "150pk/cs") but carries exactly the numbers the desc gave, no more.
  const take = (re: RegExp, fn: (m: RegExpExecArray) => string) => {
    for (let m = re.exec(rest); m; m = re.exec(rest)) { stated.push(fn(m)); rest = rest.replace(m[0], ' ') }
  }
  // containers per case: "60pk/cs", "150 pk's/cs", "24/bx/cs", "16bx/cs"
  take(/(\d+)\s*\/?\s*(pk's|pks|pk|bx|box(?:es)?)\s*\/\s*cs\b/i, (m) => {
    pack.perCase = Number(m[1]); pack.perCaseUnit = /^b/i.test(m[2]) ? 'bx' : 'pk'
    return `${m[1]}${pack.perCaseUnit}/cs`
  })
  take(/(\d+)\s*sets?\s*\/\s*cs\b/i, (m) => { pack.perCase = Number(m[1]); pack.perCaseUnit = 'set'; return `${m[1]}set/cs` })
  // pieces per pack: "12/pk", "50pc/pk", "12/bx", "24pcs/bx"
  take(/(\d+)\s*(?:pcs?|pc)?\s*\/\s*(?:pk|bx)\b/i, (m) => { pack.perPack = Number(m[1]); return `${m[1]}/pk` })
  // pieces per case: "48 pcs/cs", "24/cs", "240pc/cs"
  take(/(\d+)\s*(?:pcs?|pc)?\s*\/\s*cs\b/i, (m) => { pack.piecesPerCase = Number(m[1]); return `${m[1]}/cs` })
  // Print in name order: per-pack, then per-case containers, then total.
  const rank = (s: string) => (/\/pk$/.test(s) ? 0 : /(pk|bx|set)\/cs$/.test(s) ? 1 : 2)
  stated.sort((a, b) => rank(a) - rank(b))
  return { pack, stated, rest }
}

/** Builds the spec only from what the desc states. Returns null when incomplete. */
function buildSpec(p: Pack): { spec: string | null; note: string } {
  if (p.perPack == null || p.perCase == null || p.perCaseUnit === 'set') return { spec: null, note: '' }
  if (p.piecesPerCase != null) {
    if (p.piecesPerCase === p.perPack * p.perCase) return { spec: formatPackSpec(p.perPack, p.perCase), note: 'piece-sold (pk x bx = stated pcs/cs)' }
    if (p.piecesPerCase === p.perCase) return { spec: `${p.perPack}/pk ${p.perCase}bx/cs cs.${p.perCase}${p.perCaseUnit}`, note: 'pack-sold' }
    return { spec: null, note: `inconsistent: ${p.perPack}/pk x ${p.perCase}${p.perCaseUnit}/cs != ${p.piecesPerCase}/cs` }
  }
  // "20/pk - 60pk/cs": the desc counts containers per case, so state the unit.
  return { spec: `${p.perPack}/pk ${p.perCase}bx/cs cs.${p.perCase}${p.perCaseUnit}`, note: `stated ${p.perCaseUnit} per case` }
}

const MINOR = new Set(['a', 'an', 'and', 'of', 'with', 'w/', 'w', 'the', 'in', 'for', 'or', 'to', 'on', 'at', '&'])
/** Capitalises all-lowercase words only; anything already carrying a capital (LOVE, MOM, POE, 3D) is kept. */
function titleCase(s: string): string {
  const cap = (w: string) => w.replace(/^([^A-Za-z0-9]*)([a-z])/, (_, p, c) => p + c.toUpperCase()) // "(orange)" -> "(Orange)"
  return s.split(' ').map((word, i) => {
    if (!word || word !== word.toLowerCase()) {
      // "Beige/pink" -> "Beige/Pink"; leave "w/" alone
      return word.includes('/') && word !== 'w/' ? word.split('/').map((p) => (p === p.toLowerCase() && !/^\d/.test(p) ? cap(p) : p)).join('/') : word
    }
    if (i > 0 && MINOR.has(word)) return word
    if (/^\d/.test(word)) return word // 40oz, 650ml, 2-pc, 8ribbed stay as written
    return word.includes('/') && word !== 'w/' ? word.split('/').map(cap).join('/') : cap(word)
  }).join(' ')
}

// Spotted in this QuickBooks data. Flagged for a human, never auto-corrected.
const SUSPECTED_TYPOS: Record<string, string> = {
  Grauation: 'Graduation', Fodable: 'Foldable', Tumber: 'Tumbler', Suitecase: 'Suitcase', Majong: 'Mahjong',
  Unpatented: 'Unpatterned?',
}

const SIZE_SEG_RE = /^\d+(?:\.\d+)?\s*(?:cm|mm|inch(?:es)?|in|"|ft|feet)$/i
type NameStatus = 'ok' | 'needs_pack_spec' | 'needs_review'

function planName(desc: string, sku: string, qbFullName = '') {
  const notes: string[] = []
  const flat = desc.replace(/\r?\n/g, ' - ')
    // "Corgi Companion Plush-60cm 12/cs": a size glued on with a hyphen
    .replace(/([A-Za-z])-(\d+(?:\.\d+)?(?:cm|inch|in)\b)/gi, '$1 - $2')
  const { m, rest: noCarton } = parseMeasurements(flat)
  const { pack, stated, rest } = parsePack(noCarton)

  // "4 Style" means four styles assorted. normalizeDescriptor strips the
  // supplier-invoice filler word "Style", which would turn "4 Style Plush
  // Cup" into "4 Plush Cup" -- so protect the counted form first.
  const protectedText = rest.replace(/(\d+)\s*-?\s*style(s)?\b/gi, '$1\u00a7')
  const segs = protectedText.split(/\s+-\s+|\s*-\s*$|^\s*-\s*/)
    .map((s) => s.replace(/^[\s,.-]+|[\s,.-]+$/g, '').trim()).filter(Boolean)
  const sizes = segs.filter((s) => SIZE_SEG_RE.test(s))
  const words = segs.filter((s) => !SIZE_SEG_RE.test(s))
  let descriptor = normalizeDescriptor(words.join(' ')).replace(/(\d+)\u00a7/g, '$1 Style')
  descriptor = titleCase(descriptor.replace(/\s+/g, ' ').trim())

  // A size encoded in a variant SKU ("P273833-30cm") that the desc omits.
  const skuSize = /-(\d+(?:cm|inch|in))$/i.exec(sku)?.[1]
  if (skuSize && !sizes.length && !new RegExp(`\\b${skuSize}\\b`, 'i').test(descriptor)) {
    sizes.push(skuSize.toLowerCase()); notes.push(`size ${skuSize} taken from the SKU suffix, not the desc`)
  }
  const head = [descriptor, ...sizes].filter(Boolean).join(' ')

  let status: NameStatus = 'ok'
  if (!descriptor) { status = 'needs_review'; notes.push('no descriptor left after stripping pack/carton text') }
  for (const [bad, good] of Object.entries(SUSPECTED_TYPOS)) {
    if (new RegExp(`\\b${bad}\\b`, 'i').test(descriptor)) { status = 'needs_review'; notes.push(`suspected QB typo "${bad}" (-> ${good}), not corrected`) }
  }

  let { spec, note } = buildSpec(pack)
  let packRule = ''
  let soldBy: '' | 'piece' | 'pack' = spec ? (/cs\.\d+(pk|bx|set)$/.test(spec) ? 'pack' : 'piece') : ''
  let perPack = pack.perPack, perCase = pack.perCase
  // PLUSH RULE -- APPROVED BY DRAGON 2026-10-01 (relayed by the coordinating
  // session). A plush whose QB desc states ONLY "N/cs" is sold singly, so it
  // becomes "1/pk Nbx/cs cs.N" (piece-sold), the convention
  // create-missing-plush-in-erply.mjs used for the companion plush line.
  // Deterministic test, see plushRule() below. Nothing else gets a pk inferred.
  if (!spec && !note) {
    const p = plushRule(rest, qbFullName, pack)
    if (p.applies) {
      spec = formatPackSpec(1, pack.piecesPerCase!)
      note = 'PLUSH RULE (Dragon approved 2026-10-01): N/cs only -> 1/pk Nbx/cs cs.N'
      packRule = 'plush-1pk'; soldBy = 'piece'; perPack = 1; perCase = pack.piecesPerCase
    } else if (p.excluded) {
      notes.push(`plush rule NOT applied: ${p.excluded}`)
    }
  }
  let name: string
  if (spec) {
    name = `${head} - ${spec}`
    if (note) notes.push(note)
    const audit = auditProductName(name)
    if (audit.issues.length) { status = 'needs_review'; notes.push(`audit: ${audit.issues.join(',')}`) }
  } else {
    if (note) { status = 'needs_review'; notes.push(note) }
    else if (status === 'ok') status = 'needs_pack_spec'
    if (!stated.length) notes.push('QB desc states no pack figures at all')
    name = stated.length ? `${head} - ${stated.join(' ')}` : head
  }
  return {
    name, status, notes, stated: stated.join(' '), m, base: head, packRule, soldBy,
    perPack, perCase, perCaseUnit: pack.perCaseUnit, piecesPerCase: pack.piecesPerCase,
  }
}

/**
 * The plush test for the approved rule. Deterministic:
 *   - the QB description (pack/carton text removed) has the word "Plush" or
 *     "Plushie", OR the QB FullName path has a "Plush" parent ("Plush Toys:X");
 *   - the desc stated exactly one pack figure, a bare pieces-per-case "N/cs";
 *   - and it is not a plush-material ACCESSORY or a multi-piece SET, which are
 *     not obviously sold singly: keychain / bag charm / cup / pen / bag /
 *     backpack / slipper / hat, or a leading count of plush items ("3 Plush
 *     Grad Bears"). Those are excluded and reported, not guessed.
 */
function plushRule(descText: string, qbFullName: string, pack: Pack): { applies: boolean; excluded?: string } {
  const isPlush = /\bplush(ie)?\b/i.test(descText) || /(^|:)[^:]*\bplush\b[^:]*:/i.test(qbFullName)
  if (!isPlush) return { applies: false }
  if (pack.piecesPerCase == null || pack.perPack != null || pack.perCase != null) {
    return { applies: false, excluded: 'pack figures are not a bare N/cs' }
  }
  const accessory = /\b(key\s?chains?|bag charms?|cups?|pens?|bags?|backpacks?|slippers?|hats?)\b/i.exec(descText)
  if (accessory) return { applies: false, excluded: `plush ${accessory[1].toLowerCase()} (accessory, may not be sold singly)` }
  if (/^\s*\d+\s+plush\b/i.test(descText)) return { applies: false, excluded: 'multi-piece set ("N Plush ...")' }
  return { applies: true }
}

// ── Load everything ──────────────────────────────────────────────────────────

const tsvRows = fs.readFileSync(INPUT_TSV, 'utf8').trim().split(/\r?\n/).slice(1)
  .map((l) => l.split('\t')).map(([photo_sku, qb_sku]) => ({ photo_sku: photo_sku.trim(), qb_sku: (qb_sku ?? '').trim() }))
  .filter((r) => !ONLY || r.photo_sku.toUpperCase() === ONLY)
console.log(`${tsvRows.length} photo SKU(s) from ${path.relative(ROOT, INPUT_TSV)}`)

const qbAll = await selectAll<QbRow>('qb_item_directory', 'sku, full_name, sales_desc, item_type, sales_price, is_active')
console.log(`${qbAll.length} QuickBooks items in qb_item_directory`)

const products = await selectAll<{ sku: string; name: string; category_id: string | null }>('products', 'sku, name, category_id')
const catalogBySku = new Map(products.map((p) => [p.sku.trim().toUpperCase(), p]))
const categories = await selectAll<{ id: string; name: string }>('categories', 'id, name')
const catIdByName = new Map(categories.map((c) => [c.name.toLowerCase(), c]))
console.log(`${products.length} catalog products, ${categories.length} categories`)

const erplyList = await erplyAll()
const erplyCodes = new Set(erplyList.map((p) => String(p.code ?? '').trim().toUpperCase()))
console.log(`${erplyList.length} Erply products (default statuses) for the neighbour/variant scan`)

console.log(`scanning ${SEARCH_ROOT} for photos (June sample folders excluded) ...`)
const files = readImageFiles([SEARCH_ROOT], { recursive: true, skipDirs: SKIP_DIRS })
console.log(`${files.length} image file(s)\n`)

// ── Category ─────────────────────────────────────────────────────────────────
// Erply's own groups are too inconsistent to vote with (Keychain vs Keychains,
// pen vs Pens, TOY, Floral Papers, Wrapping Paper -- several have no catalog
// category at all). The CATALOG's categories are the curated ones, so:
//   1. every catalog product with the same SKU letter-prefix within +/-10
//      that has a category must be in ONE category (min 2), and
//   2. the name must not mention a DIFFERENT existing category by name (T642194
//      "Umbrella" sits among Mirrors), and
//   3. the Erply group is the one those neighbours' Erply records use that
//      resolves (resolveErplyCategoryAlias) to that category, falling back to
//      the account-wide dominant group for it.
// Anything else is unassigned and flagged. A proposal is still a proposal:
// SKU neighbourhoods are a strong hint on this account, not a guarantee.

function splitSku(sku: string): { prefix: string; num: number } | null {
  const m = /^(3D|[A-Z]+)(\d+)/i.exec(sku)
  return m ? { prefix: m[1].toUpperCase(), num: Number(m[2]) } : null
}
const nearSku = (sku: string, other: string) => {
  const a = splitSku(sku), b = splitSku(other)
  return !!a && !!b && a.prefix === b.prefix && Math.abs(a.num - b.num) <= 10 && a.num !== b.num
}
const catById = new Map(categories.map((c) => [c.id, c.name]))
// Category names usable as a word test: single words or plain phrases only.
const NAME_TESTS = categories
  .filter((c) => !/[&/]/.test(c.name))
  .map((c) => ({ id: c.id, name: c.name, re: new RegExp(`\\b(${c.name.replace(/s$/i, '')})s?\\b`, 'i') }))

function dominantErplyGroup(rows: ErplyProduct[], catName: string) {
  const counts = new Map<number, { name: string; n: number }>()
  for (const p of rows) {
    if (!p.groupID || resolveErplyCategoryAlias(String(p.groupName ?? '')).toLowerCase() !== catName.toLowerCase()) continue
    counts.set(p.groupID, { name: p.groupName ?? '', n: (counts.get(p.groupID)?.n ?? 0) + 1 })
  }
  const best = [...counts.entries()].sort((a, b) => b[1].n - a[1].n)[0]
  return best ? { id: String(best[0]), name: best[1].name } : null
}

function proposeCategory(sku: string, nameBase: string) {
  const none = { groupId: '', groupName: '', catId: '', catName: '', basis: '' }
  const hits = NAME_TESTS.filter((t) => t.re.test(nameBase))
  const hint = hits.length ? `; name mentions ${hits.map((h) => h.name).join('/')}` : ''

  const near = products.filter((p) => p.category_id && nearSku(sku, p.sku))
  const votes = new Map<string, number>()
  for (const p of near) votes.set(p.category_id!, (votes.get(p.category_id!) ?? 0) + 1)
  const summary = [...votes.entries()].map(([id, n]) => `${catById.get(id) ?? id} x${n}`).join(', ')
  if (near.length < 2) return { ...none, basis: `unassigned: ${near.length} categorised catalog neighbour(s) within +/-10${hint}` }
  if (votes.size !== 1) return { ...none, basis: `unassigned: catalog neighbours split (${summary})${hint}` }

  const [catId] = [...votes.keys()]
  const catName = catById.get(catId) ?? ''
  if (hits.length && !hits.some((h) => h.id === catId)) {
    return { ...none, basis: `unassigned: CONFLICT -- neighbours say ${catName} x${near.length}${hint}` }
  }
  const erplyNear = erplyList.filter((p) => nearSku(sku, String(p.code ?? '')))
  const g = dominantErplyGroup(erplyNear, catName) ?? dominantErplyGroup(erplyList, catName)
  const gBasis = !g ? '; NO Erply group resolves to it' : dominantErplyGroup(erplyNear, catName) ? '' : `; Erply group = account-wide dominant for ${catName}`
  return {
    groupId: g?.id ?? '', groupName: g?.name ?? '', catId, catName,
    basis: `${near.length}/${near.length} catalog neighbours within +/-10 in ${catName}${hits.length ? ' (name agrees)' : ''}${gBasis}`,
  }
}

// ── Photos ───────────────────────────────────────────────────────────────────
// Every photo SKU and every QB variant SKU is its own key, so exact-SKU files
// land on the variant and bare-base files land on the base -- never crossed.

const isVariantOf = (qbSku: string, base: string) =>
  qbSku.toUpperCase().startsWith(base) && /^[-\s_]/.test(qbSku.slice(base.length))

const photoKeys = new Map<string, { sku: string }>()
for (const r of tsvRows) {
  const base = r.photo_sku.toUpperCase()
  photoKeys.set(base, { sku: base })
  for (const q of qbAll) if (isVariantOf(String(q.sku), base)) photoKeys.set(String(q.sku).toUpperCase(), { sku: String(q.sku).toUpperCase() })
}
const { plan: photoPlan } = matchFilesToProducts(files, photoKeys)
const photosFor = (sku: string) => {
  const e = photoPlan.get(sku.toUpperCase())
  if (!e) return { names: [] as string[], dir: '' }
  const ordered = [e.primary, ...e.views.sort((a, b) => a.n - b.n).map((v) => v.file)].filter(Boolean) as typeof files
  return { names: ordered.map((f) => f.name), dir: [...new Set(ordered.map((f) => path.relative(SEARCH_ROOT, f.dir)))].join(' | ') }
}

// ── Plan ─────────────────────────────────────────────────────────────────────

type PlanRow = Record<string, string | number | null>
const out: PlanRow[] = []
const nowExists: string[] = []
const variantCases: string[] = []
const erplyPayloads: Record<string, string>[] = []
const catalogPayloads: Record<string, unknown>[] = []

for (const r of tsvRows) {
  const base = r.photo_sku.toUpperCase()
  const exact = qbAll.filter((q) => String(q.sku).toUpperCase() === base)
  // "F28802" + "3" is a different SKU, not a variant -- variants follow a "-".
  const variants = qbAll.filter((q) => isVariantOf(String(q.sku), base))

  // Which QuickBooks record does each photo belong to? Decided by the photo
  // FILE NAME, never by guessing a bare base onto a variant:
  //   exact          one bare record, no variants
  //   variant+photo  a suffixed record with its own exact-named photo
  //                  (F288023-VLT.jpg) -- a distinct product, plannable
  //   ambiguous      a bare record alongside variants (T642208), several
  //                  bare records, or a variant whose only photos are
  //                  bare-base ones -- a human has to look at the photo
  //   no_photo       a variant with no photo of its own at all
  let candidates: { q: QbRow; basis: string }[]
  let familyNote = ''
  const familyAll = [...exact, ...variants]
  if (exact.length === 1 && variants.length === 0) candidates = [{ q: exact[0], basis: 'exact' }]
  else {
    familyNote = `${exact.length} bare + ${variants.length} suffixed QB record(s): ${familyAll.map((q) => q.full_name).join(', ')}`
    candidates = familyAll.map((q) => {
      const isBare = String(q.sku).toUpperCase() === base
      if (isBare) return { q, basis: 'ambiguous' }
      if (photosFor(String(q.sku)).names.length) return { q, basis: 'variant+photo' }
      return { q, basis: photosFor(base).names.length ? 'ambiguous' : 'no_photo' }
    })
  }
  if (candidates.length === 0) {
    out.push({ photo_sku: r.photo_sku, planned_sku: '', sku_basis: 'missing', skip_reason: 'no QB record with this SKU any more' })
    continue
  }
  if (candidates.some((c) => c.basis !== 'exact')) {
    variantCases.push(`${r.photo_sku} (TSV chose ${r.qb_sku}): ${candidates.map((c) => `${c.q.full_name} [${c.basis}] "${(c.q.sales_desc ?? '').replace(/\s+/g, ' ').slice(0, 70)}"`).join(' ;; ')}`)
  }

  for (const { q, basis } of candidates) {
    const sku = String(q.sku).trim()
    const desc = (q.sales_desc ?? '').trim()
    const skip: string[] = []

    // Live re-check: still absent from Erply and the catalog?
    for (const code of [...new Set([r.photo_sku, sku])]) {
      const hits = await erplyByCode(code)
      if (hits.length) skip.push(`now in Erply: ${hits.map((h) => `${h.code} #${h.productID} ${h.status ?? ''}`.trim()).join(', ')}`)
      if (catalogBySku.has(code.toUpperCase())) skip.push(`now in catalog: ${catalogBySku.get(code.toUpperCase())!.name}`)
    }
    if (skip.length) nowExists.push(`${r.photo_sku}/${sku}: ${skip.join('; ')}`)
    const erplyVariants = [...erplyCodes].filter((c) => c.startsWith(base + '-'))
    const catVariants = [...catalogBySku.keys()].filter((c) => c.startsWith(base + '-'))
    const familyElsewhere = [...erplyVariants.map((c) => `Erply ${c}`), ...catVariants.map((c) => `catalog ${c}`)].join(', ')
    if (basis === 'ambiguous') skip.push(`ambiguous: ${familyNote}; only bare-base photos -- a human must match photo to record`)
    if (basis === 'no_photo') skip.push(`no photo named for this variant (${familyNote})`)
    if (!desc) skip.push('QB record has no description')

    const n = planName(desc, sku, q.full_name)
    let nameStatus: NameStatus = n.status
    const notes = [...n.notes]
    if (basis === 'ambiguous' || basis === 'no_photo') {
      nameStatus = 'needs_review'
      notes.unshift(`${basis}: ${familyNote}`)
    } else if (basis === 'variant+photo') {
      notes.unshift(`variant of ${r.photo_sku} with its own photo; siblings: ${familyAll.map((q) => q.sku).join(', ')}`)
    }
    if (q.is_active === false) notes.push('QB item is INACTIVE')
    if (q.full_name.includes(':')) notes.push(`QB sub-item ${q.full_name}`)

    // Test only the descriptor, not the trailing " - <pack>" part.
    const cat = proposeCategory(sku, n.stated || /\/pk/.test(n.name) ? n.name.replace(/\s+-\s+[^-]*$/, '') : n.name)
    const exactPhotos = photosFor(sku)
    const basePhotos = sku.toUpperCase() !== base ? photosFor(base) : { names: [] as string[], dir: '' }
    const price = q.sales_price == null ? null : Number(q.sales_price)

    out.push({
      photo_sku: r.photo_sku,
      planned_sku: sku,
      sku_basis: basis,
      qb_full_name: q.full_name,
      qb_item_type: q.item_type,
      qb_active: q.is_active === false ? 'no' : 'yes',
      qb_desc: desc.replace(/\r?\n/g, ' / '),
      proposed_name: n.name,
      name_status: nameStatus,
      name_notes: notes.join('; '),
      stated_pack: n.stated,
      // Machine-readable pack facts for scripts/build-qb-product-fill-sheet.ts.
      // Only what the desc stated (or the approved plush rule) -- never inferred.
      proposed_base: n.base,
      pieces_per_pack: n.perPack,
      packs_per_case: n.perCase,
      packs_per_case_unit: n.perCaseUnit,
      pieces_per_case_stated: n.piecesPerCase,
      sold_by: n.soldBy,
      pack_rule: n.packRule,
      case_length_in: n.m.case_length_in,
      case_width_in: n.m.case_width_in,
      case_height_in: n.m.case_height_in,
      case_weight_lb: n.m.case_weight_lb,
      measure_basis: n.m.basis,
      measure_flag: n.m.flag,
      qb_price: price == null ? '' : price.toFixed(2),
      price_flag: price == null ? 'no QB price' : price <= 0 ? 'QB price is $0' : '',
      erply_group_id: cat.groupId,
      erply_group_name: cat.groupName,
      catalog_category_id: cat.catId,
      catalog_category: cat.catName,
      category_basis: cat.basis,
      photo_files: exactPhotos.names.join(' '),
      candidate_photo_files_unconfirmed: basePhotos.names.join(' '),
      photo_dir: exactPhotos.dir || basePhotos.dir,
      // Files that start with the SKU but the matcher rightly refuses, e.g.
      // "T642190_barcode.png" -- a barcode label, not a product photo.
      other_sku_files_not_matched: files
        .filter((f) => f.stem.toUpperCase().startsWith(base) && !exactPhotos.names.includes(f.name) && !basePhotos.names.includes(f.name)
          && !photoKeys.has(f.stem.toUpperCase()) && !photoKeys.has(f.stem.toUpperCase().replace(/[-_]\d+$/, '')))
        .map((f) => f.name).join(' '),
      family_elsewhere: familyElsewhere,
      skip_reason: skip.join('; '),
    })

    if (!skip.length) {
      // What a create WOULD send. Mirrors lib/erply.ts createErplyProduct. No
      // price (Erply discards it on this account; priced by hand in Erply), no
      // code2 (qb_item_directory holds no barcode).
      const ep: Record<string, string> = { request: 'saveProduct', code: sku, name: n.name, status: 'ACTIVE' }
      if (cat.groupId) ep.groupID = cat.groupId
      erplyPayloads.push(ep)
      const hasCase = n.m.case_length_in != null || n.m.case_weight_lb != null
      catalogPayloads.push({
        // NO `id`: products.id defaults from products_id_seq (0020/0052).
        sku, barcode: null, name: n.name, description: null,
        price_cents: 0, stock_qty: 0, is_active: true,
        manually_hidden: true, // a visible $0 product is orderable
        needs_photo: exactPhotos.names.length === 0,
        category_id: cat.catId || null, image_url: null, image_urls: [],
        case_length_in: n.m.case_length_in, case_width_in: n.m.case_width_in,
        case_height_in: n.m.case_height_in, case_weight_lb: n.m.case_weight_lb,
        // 'manual' + an updated_by, the P257281 precedent: protects the
        // figures from the Erply backfill (0045 allows only erply/woo/manual).
        ...(hasCase ? { measurements_source: 'manual', measurements_updated_by: `qb-desc:${sku}` } : {}),
      })
    }
  }
}

// ── Output ───────────────────────────────────────────────────────────────────

const COLS = ['photo_sku', 'planned_sku', 'sku_basis', 'qb_full_name', 'qb_item_type', 'qb_active', 'qb_desc', 'proposed_name', 'name_status', 'name_notes', 'stated_pack',
  'proposed_base', 'pieces_per_pack', 'packs_per_case', 'packs_per_case_unit', 'pieces_per_case_stated', 'sold_by', 'pack_rule',
  'case_length_in', 'case_width_in', 'case_height_in', 'case_weight_lb', 'measure_basis', 'measure_flag', 'qb_price', 'price_flag',
  'erply_group_id', 'erply_group_name', 'catalog_category_id', 'catalog_category', 'category_basis',
  'photo_files', 'candidate_photo_files_unconfirmed', 'photo_dir', 'other_sku_files_not_matched', 'family_elsewhere', 'skip_reason']
const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
const now = new Date()
const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
const csvPath = path.join(ROOT, 'data', `qb-product-create-plan-${stamp}${ONLY ? `-${ONLY}` : ''}.csv`)
fs.writeFileSync(csvPath, [COLS.join(','), ...out.map((r) => COLS.map((c) => esc(r[c])).join(','))].join('\n') + '\n')

const planned = out.filter((r) => r.planned_sku)
const creatable = planned.filter((r) => !r.skip_reason)
const count = (rows: PlanRow[], f: (r: PlanRow) => boolean) => rows.filter(f).length
const by = (rows: PlanRow[], k: string) => {
  const m = new Map<string, number>()
  for (const r of rows) m.set(String(r[k] ?? ''), (m.get(String(r[k] ?? '')) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k2, v]) => `${k2 || '(blank)'}: ${v}`).join(' | ')
}

console.log('=== Plan (DRY RUN -- nothing written anywhere) ===')
console.log(`photo SKUs in: ${tsvRows.length}   plan rows: ${out.length}   no skip reason: ${creatable.length}`)
console.log(`sku_basis:  ${by(out, 'sku_basis')}`)
console.log(`name_status, all plan rows:       ${by(planned, 'name_status')}`)
console.log(`name_status, rows not skipped:    ${by(creatable, 'name_status')}`)
console.log(`plush rule (approved 2026-10-01) completed: ${count(planned, (r) => r.pack_rule === 'plush-1pk')} -> ${planned.filter((r) => r.pack_rule === 'plush-1pk').map((r) => r.planned_sku).join(', ')}`)
console.log(`plush rule excluded: ${planned.filter((r) => /plush rule NOT applied/.test(String(r.name_notes))).map((r) => `${r.planned_sku} (${/plush rule NOT applied: ([^;]*)/.exec(String(r.name_notes))![1]})`).join('; ') || 'none'}`)
console.log(`full carton (L+W+H+lb): ${count(planned, (r) => r.case_length_in != null && r.case_weight_lb != null)}   any measurement: ${count(planned, (r) => r.case_length_in != null || r.case_weight_lb != null)}`)
console.log(`measure_basis: ${by(planned.filter((r) => r.measure_basis), 'measure_basis')}`)
console.log(`measure_flag:  ${by(planned.filter((r) => r.measure_flag), 'measure_flag')}`)
console.log(`QB price $0: ${count(planned, (r) => r.price_flag === 'QB price is $0')}   no QB price: ${count(planned, (r) => r.price_flag === 'no QB price')}`)
console.log(`category proposed: ${count(planned, (r) => !!r.erply_group_id)} (catalog category resolved: ${count(planned, (r) => !!r.catalog_category_id)})   unassigned: ${count(planned, (r) => !r.erply_group_id)}`)
console.log(`  proposals: ${by(planned.filter((r) => r.erply_group_id), 'catalog_category')}`)
console.log(`photos: exact-SKU files for ${count(planned, (r) => !!r.photo_files)} row(s); bare-base candidates only (unconfirmed) for ${count(planned, (r) => !r.photo_files && !!r.candidate_photo_files_unconfirmed)}; none for ${count(planned, (r) => !r.photo_files && !r.candidate_photo_files_unconfirmed)}`)
if (archivedLookupError) console.log(`NOTE: ARCHIVED-status Erply lookup failed (${archivedLookupError}); only default statuses were re-checked`)

console.log(`\nVariant / suffix cases (${variantCases.length}):`)
for (const v of variantCases) console.log(`  ${v}`)
console.log(`\nNow exist in Erply/catalog since the TSV was built (${nowExists.length}):`)
for (const v of nowExists) console.log(`  ${v}`)
const fam = planned.filter((r) => r.family_elsewhere)
console.log(`\nBase SKU has suffixed siblings already in Erply/catalog (${fam.length}):`)
for (const r of fam) console.log(`  ${r.photo_sku} -> ${r.family_elsewhere}`)

console.log(`\nAll plan rows:`)
for (const r of planned) {
  console.log(`  [${String(r.name_status).padEnd(15)}] ${String(r.planned_sku).padEnd(14)} "${r.qb_desc}"\n${' '.repeat(20)}-> "${r.proposed_name}"  {${r.case_length_in ?? '-'}x${r.case_width_in ?? '-'}x${r.case_height_in ?? '-'} ${r.case_weight_lb ?? '-'}lb} ${r.catalog_category || '(no cat)'} ${r.skip_reason ? 'SKIP: ' + r.skip_reason : ''}`)
}
console.log(`\n${erplyPayloads.length} Erply saveProduct payload(s) and ${catalogPayloads.length} catalog insert(s) would be built; first of each:`)
if (erplyPayloads[0]) console.log('  erply  ', JSON.stringify(erplyPayloads[0]))
if (catalogPayloads[0]) console.log('  catalog', JSON.stringify(catalogPayloads[0]))
console.log(`\nCSV: ${path.relative(ROOT, csvPath)}`)

// No --apply here, by design: this only plans. Creating goes through the fill
// sheet (build-qb-product-fill-sheet.ts -> import-qb-product-fill-sheet.ts) and
// then scripts/apply-qb-product-create.ts, which creates the importer's
// "ready" rows in Erply and the catalog.
