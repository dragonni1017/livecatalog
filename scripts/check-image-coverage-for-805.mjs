// check-image-coverage-for-805.mjs
// Run with: node scripts/check-image-coverage-for-805.mjs
//
// Answers: of the 805 new QBD products (data/qbd-catalog-compare/
// 805-new-products-review.xlsx), how many can have an image filled in from
// something we ALREADY have, rather than needing a new photo shoot?
//
// The earlier deep-review pass reported "0 with a Cloudinary image" for
// every category, but that check was deliberately narrow: exact
// case-sensitive `public_id === SKU` only. This script is the real answer,
// checking every source we actually have and matching more forgivingly:
//
// SOURCES CHECKED
//   1. Live Cloudinary account (paginated resources list, ~2,400 assets)
//   2. Local image files on disk under data/images/** (~2,818 files)
//   3. Existing SKU->image mapping CSVs in data/images/:
//        cloudinary-image-list.csv          (sku,name,image_url)
//        local-to-cloudinary-backfill-results.csv (sku,url,status,...)
//        erply-cdn-image-mapping.csv        (sku,image_filename)
//        recent-3mo-image-mapping.csv       (sku -> file)
//        imgur-upload-mapping.csv           (sku -> url)
//        image-source-matrix.csv            (per-source has-image flags)
//   4. Supabase products.image_url (a SKU may exist in the catalog DB
//      under a slightly different code than QB used)
//
// MATCH STRATEGY, loosest-last so the strongest match wins and every hit
// records HOW it matched (never silently fuzzy):
//   a. exact            -- identical after trim
//   b. case-insensitive -- "b324055" vs "B324055" (confirmed real in this
//                          data: the QBD export has genuinely mixed-case
//                          SKUs like "s162517", "p257056", "b324055")
//   c. normalized       -- strip spaces/dots/underscores AND collapse
//                          hyphens, so "F102518 - AGRY" / "F102518-AGRY" /
//                          "F102518AGRY" all unify (this exact spacing
//                          drift was already confirmed live earlier this
//                          session in the barcode-only-match findings)
//   d. base-SKU         -- the SKU with a trailing colour/size variant
//                          suffix removed ("P273842-45cm" -> "P273842").
//                          REPORTED SEPARATELY and never counted in the
//                          headline number: a base-SKU hit means "a
//                          sibling variant has a photo", which is a
//                          candidate for reuse, NOT proof this exact
//                          variant's image exists. Colour variants in
//                          particular must not inherit a sibling's photo
//                          silently.
//
// Read-only everywhere. Writes a NEW xlsx report to
// data/qbd-catalog-compare/805-image-coverage.xlsx.

import fs from 'fs'
import path from 'path'
import https from 'https'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME
const API_KEY = process.env.CLOUDINARY_API_KEY
const API_SECRET = process.env.CLOUDINARY_API_SECRET
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const SOURCE_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', '805-new-products-review.xlsx')
const OUT_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', '805-image-coverage.xlsx')
const IMAGES_DIR = path.join(ROOT, 'data', 'images')

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i

// ---- key normalizers -------------------------------------------------

const kExact = (s) => String(s || '').trim()
const kCase = (s) => kExact(s).toUpperCase()
const kNorm = (s) => kCase(s).replace(/[\s._-]+/g, '')
// Trailing variant suffix: -45cm, -60CM, -MIX, -RED, -B, -1, " - AGRY" etc.
const kBase = (s) => kCase(s).replace(/[\s._-]+[A-Z0-9]{1,6}$/i, '')

// ---- source loaders --------------------------------------------------

function fetchCloudinaryPage(nextCursor) {
  return new Promise((resolve, reject) => {
    const AUTH = Buffer.from(`${API_KEY}:${API_SECRET}`).toString('base64')
    const qs = new URLSearchParams({ max_results: '500' })
    if (nextCursor) qs.set('next_cursor', nextCursor)
    https.get({ hostname: 'api.cloudinary.com', path: `/v1_1/${CLOUD_NAME}/resources/image?${qs}`, headers: { Authorization: `Basic ${AUTH}` } }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch (e) { reject(e) } })
    }).on('error', reject)
  })
}
async function loadCloudinary() {
  const out = []
  let cursor = null
  do {
    const result = await fetchCloudinaryPage(cursor)
    if (result.error) throw new Error(result.error.message)
    for (const r of result.resources || []) out.push({ id: r.public_id, ref: r.secure_url })
    cursor = result.next_cursor || null
  } while (cursor)
  return out
}

function walkFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(full, acc)
    else if (IMAGE_EXT.test(entry.name)) acc.push(full)
  }
  return acc
}
function loadLocalFiles() {
  return walkFiles(IMAGES_DIR).map((full) => ({
    id: path.basename(full).replace(IMAGE_EXT, ''),
    ref: path.relative(ROOT, full),
  }))
}

function parseCsv(text) {
  // Minimal RFC4180-ish parser -- these CSVs contain quoted commas in
  // product names, so a naive split(',') would misalign columns.
  const rows = []
  let row = [], field = '', inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') inQuotes = false
      else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = '' }
    else if (c !== '\r') field += c
  }
  if (field || row.length) { row.push(field); rows.push(row) }
  return rows
}

function loadCsvMapping(file, skuCol, refCol, filterFn) {
  const full = path.join(IMAGES_DIR, file)
  if (!fs.existsSync(full)) return []
  const rows = parseCsv(fs.readFileSync(full, 'utf8'))
  if (rows.length < 2) return []
  const header = rows[0].map((h) => h.trim())
  const si = header.indexOf(skuCol)
  const ri = header.indexOf(refCol)
  if (si === -1 || ri === -1) return []
  const out = []
  for (const r of rows.slice(1)) {
    if (!r[si] || !r[ri]) continue
    if (filterFn && !filterFn(r, header)) continue
    out.push({ id: r[si].trim(), ref: r[ri].trim() })
  }
  return out
}

async function loadSupabase() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return []
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const all = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from('products').select('sku, image_url').not('image_url', 'is', null).range(from, from + PAGE - 1)
    if (error) { console.error('Supabase read error:', error.message); break }
    all.push(...data)
    if (data.length < PAGE) break
  }
  return all.filter((p) => p.sku && p.image_url).map((p) => ({ id: p.sku, ref: p.image_url }))
}

// ---- index + lookup --------------------------------------------------

function buildIndex(entries) {
  const exact = new Map(), ci = new Map(), norm = new Map(), base = new Map()
  for (const e of entries) {
    const id = kExact(e.id)
    if (!id) continue
    if (!exact.has(id)) exact.set(id, e)
    const c = kCase(id); if (!ci.has(c)) ci.set(c, e)
    const n = kNorm(id); if (n && !norm.has(n)) norm.set(n, e)
    const b = kBase(id); if (b && b !== c && !base.has(b)) base.set(b, e)
  }
  return { exact, ci, norm, base }
}

function lookup(index, sku) {
  const s = kExact(sku)
  if (index.exact.has(s)) return { how: 'exact', hit: index.exact.get(s) }
  if (index.ci.has(kCase(s))) return { how: 'case-insensitive', hit: index.ci.get(kCase(s)) }
  const n = kNorm(s)
  if (n && index.norm.has(n)) return { how: 'normalized', hit: index.norm.get(n) }
  const b = kBase(s)
  if (b && index.base.has(b)) return { how: 'base-sku-variant', hit: index.base.get(b) }
  if (b && index.ci.has(b)) return { how: 'base-sku-variant', hit: index.ci.get(b) }
  return null
}

// ---- main ------------------------------------------------------------

async function main() {
  const wb = XLSX.readFile(SOURCE_XLSX)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['All 805'], { defval: null })
  console.log(`Target products: ${rows.length}`)

  console.log('\nLoading sources...')
  const sources = {}

  sources.cloudinary = await loadCloudinary()
  console.log(`  Cloudinary live:        ${sources.cloudinary.length}`)

  sources.localFiles = loadLocalFiles()
  console.log(`  Local image files:      ${sources.localFiles.length}`)

  sources.cloudinaryCsv = loadCsvMapping('cloudinary-image-list.csv', 'sku', 'image_url')
  console.log(`  cloudinary-image-list:  ${sources.cloudinaryCsv.length}`)

  sources.localBackfillCsv = loadCsvMapping(
    'local-to-cloudinary-backfill-results.csv', 'sku', 'url',
    (r, h) => { const si = h.indexOf('status'); return si === -1 || /uploaded|relinked/i.test(r[si] || '') },
  )
  console.log(`  local-to-cloudinary:    ${sources.localBackfillCsv.length}`)

  sources.erplyCdnCsv = loadCsvMapping('erply-cdn-image-mapping.csv', 'sku', 'image_filename')
  console.log(`  erply-cdn-mapping:      ${sources.erplyCdnCsv.length}`)

  sources.recent3moCsv = loadCsvMapping('recent-3mo-image-mapping.csv', 'sku', 'file')
    .concat(loadCsvMapping('recent-3mo-image-mapping.csv', 'sku', 'filename'))
    .concat(loadCsvMapping('recent-3mo-image-mapping.csv', 'sku', 'url'))
  console.log(`  recent-3mo-mapping:     ${sources.recent3moCsv.length}`)

  sources.imgurCsv = loadCsvMapping('imgur-upload-mapping.csv', 'sku', 'url')
    .concat(loadCsvMapping('imgur-upload-mapping.csv', 'sku', 'link'))
  console.log(`  imgur-mapping:          ${sources.imgurCsv.length}`)

  sources.supabase = await loadSupabase()
  console.log(`  Supabase image_url:     ${sources.supabase.length}`)

  const indexes = Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, buildIndex(v)]))

  // Preference order: a real hosted URL beats a local file on disk.
  const ORDER = [
    ['cloudinary', 'Cloudinary (live account)'],
    ['cloudinaryCsv', 'cloudinary-image-list.csv'],
    ['localBackfillCsv', 'local-to-cloudinary-backfill-results.csv'],
    ['supabase', 'Supabase products.image_url'],
    ['imgurCsv', 'imgur-upload-mapping.csv'],
    ['erplyCdnCsv', 'erply-cdn-image-mapping.csv'],
    ['recent3moCsv', 'recent-3mo-image-mapping.csv'],
    ['localFiles', 'Local file on disk (data/images/**)'],
  ]

  const results = rows.map((r) => {
    const sku = r.proposed_sku
    let direct = null, variant = null
    for (const [key, label] of ORDER) {
      const res = lookup(indexes[key], sku)
      if (!res) continue
      const rec = { source: label, how: res.how, ref: res.hit.ref, matchedId: res.hit.id }
      if (res.how === 'base-sku-variant') { if (!variant) variant = rec }
      else { direct = rec; break }
    }
    const chosen = direct || null
    return {
      sku,
      product_name: r.proposed_name,
      category: r.original_qb_prefix,
      image_found: chosen ? 'YES' : (variant ? 'VARIANT-ONLY' : 'NO'),
      match_type: chosen ? chosen.how : (variant ? variant.how : ''),
      source: chosen ? chosen.source : (variant ? variant.source : ''),
      matched_id: chosen ? chosen.matchedId : (variant ? variant.matchedId : ''),
      image_ref: chosen ? chosen.ref : (variant ? variant.ref : ''),
      notes: chosen ? '' : (variant
        ? 'SIBLING VARIANT ONLY -- a different size/colour variant of this base SKU has an image. NOT proof this exact variant has one; reuse only after visually confirming the variant actually looks the same.'
        : 'No image found in any existing source -- needs a new photo.'),
    }
  })

  const direct = results.filter((r) => r.image_found === 'YES')
  const variantOnly = results.filter((r) => r.image_found === 'VARIANT-ONLY')
  const none = results.filter((r) => r.image_found === 'NO')

  console.log(`\n=== COVERAGE ===`)
  console.log(`Direct image available:        ${direct.length} / ${rows.length} (${(direct.length / rows.length * 100).toFixed(1)}%)`)
  console.log(`Sibling-variant image only:    ${variantOnly.length} (candidates, NOT counted as covered)`)
  console.log(`No image anywhere:             ${none.length}`)

  const byMatch = new Map(), bySource = new Map()
  for (const r of direct) {
    byMatch.set(r.match_type, (byMatch.get(r.match_type) || 0) + 1)
    bySource.set(r.source, (bySource.get(r.source) || 0) + 1)
  }
  if (direct.length) {
    console.log('\nDirect hits by match type:')
    for (const [k, v] of [...byMatch].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`)
    console.log('\nDirect hits by source:')
    for (const [k, v] of [...bySource].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`)
  }

  const byCat = new Map()
  for (const r of results) {
    const c = r.category || '(none)'
    if (!byCat.has(c)) byCat.set(c, { total: 0, yes: 0, variant: 0 })
    const e = byCat.get(c)
    e.total++
    if (r.image_found === 'YES') e.yes++
    if (r.image_found === 'VARIANT-ONLY') e.variant++
  }

  const summaryRows = [
    { metric: 'Total new products', value: rows.length },
    { metric: 'Direct image available (fillable now)', value: direct.length },
    { metric: 'Sibling-variant image only (needs visual confirm)', value: variantOnly.length },
    { metric: 'No image in any source', value: none.length },
    { metric: '', value: '' },
    { metric: '-- Direct hits by match type --', value: '' },
    ...[...byMatch].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ metric: k, value: v })),
    { metric: '', value: '' },
    { metric: '-- Direct hits by source --', value: '' },
    ...[...bySource].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ metric: k, value: v })),
    { metric: '', value: '' },
    { metric: '-- Coverage by category (yes / variant / total) --', value: '' },
    ...[...byCat].sort((a, b) => b[1].total - a[1].total).map(([k, v]) => ({ metric: k, value: `${v.yes} / ${v.variant} / ${v.total}` })),
  ]

  const wbOut = XLSX.utils.book_new()
  const mk = (data, cols) => { const ws = XLSX.utils.json_to_sheet(data); ws['!cols'] = cols; ws['!autofilter'] = { ref: ws['!ref'] }; return ws }
  const wide = [{ wch: 16 }, { wch: 50 }, { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 36 }, { wch: 18 }, { wch: 60 }, { wch: 70 }]

  const sumWs = XLSX.utils.json_to_sheet(summaryRows)
  sumWs['!cols'] = [{ wch: 52 }, { wch: 22 }]
  XLSX.utils.book_append_sheet(wbOut, sumWs, 'Summary')
  XLSX.utils.book_append_sheet(wbOut, mk(direct, wide), 'Fillable Now')
  XLSX.utils.book_append_sheet(wbOut, mk(variantOnly, wide), 'Variant Only')
  XLSX.utils.book_append_sheet(wbOut, mk(none, wide), 'No Image')
  XLSX.utils.book_append_sheet(wbOut, mk(results, wide), 'All 805')

  fs.mkdirSync(path.dirname(OUT_XLSX), { recursive: true })
  XLSX.writeFile(wbOut, OUT_XLSX)
  console.log(`\nWrote ${path.relative(ROOT, OUT_XLSX)}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
