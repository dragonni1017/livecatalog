// check-image-coverage-for-missing-catalog.mjs
// Run with: node scripts/check-image-coverage-for-missing-catalog.mjs
//
// Companion to check-image-coverage-for-805.mjs, but for the OTHER gap:
// the 868 EXISTING catalog products (in Supabase already) that have no
// image_url set. Unlike the 805 QBD items (which were never in the
// catalog, so by definition never had a photo taken for them), these are
// real catalog SKUs -- so there's a real chance an image exists under a
// slightly different key (a color/size variant suffix, different casing,
// a stray space) in one of the source dumps even though products.image_url
// was never actually populated.
//
// Reuses the exact same source-loading and 4-tier match strategy as the
// 805 script (exact -> case-insensitive -> normalized -> base-SKU variant,
// loosest last, base-SKU reported separately and never counted as direct
// coverage) -- see that script's header for the full rationale.
//
// Read-only everywhere. Writes a NEW xlsx report to
// data/qbd-catalog-compare/missing-catalog-images-coverage.xlsx.

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

const OUT_XLSX = path.join(ROOT, 'data', 'qbd-catalog-compare', 'missing-catalog-images-coverage.xlsx')
const IMAGES_DIR = path.join(ROOT, 'data', 'images')
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i

const kExact = (s) => String(s || '').trim()
const kCase = (s) => kExact(s).toUpperCase()
const kNorm = (s) => kCase(s).replace(/[\s._-]+/g, '')
const kBase = (s) => kCase(s).replace(/[\s._-]+[A-Z0-9]{1,6}$/i, '')

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
  return walkFiles(IMAGES_DIR).map((full) => ({ id: path.basename(full).replace(IMAGE_EXT, ''), ref: path.relative(ROOT, full) }))
}

function parseCsv(text) {
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

async function loadCatalogProducts() {
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  const all = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('products')
      .select('sku, name, image_url, is_active, manually_hidden')
      .range(from, from + PAGE - 1)
    if (error) { console.error(error.message); process.exit(1) }
    all.push(...data)
    if (data.length < PAGE) break
  }
  return all
}

async function main() {
  console.log('Loading catalog products from Supabase...')
  const products = await loadCatalogProducts()
  const missing = products.filter((p) => !p.image_url || !String(p.image_url).trim())
  console.log(`Catalog products: ${products.length}`)
  console.log(`Missing image_url: ${missing.length}`)

  console.log('\nLoading image sources...')
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

  const indexes = Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, buildIndex(v)]))
  const ORDER = [
    ['cloudinary', 'Cloudinary (live account)'],
    ['cloudinaryCsv', 'cloudinary-image-list.csv'],
    ['localBackfillCsv', 'local-to-cloudinary-backfill-results.csv'],
    ['erplyCdnCsv', 'erply-cdn-image-mapping.csv'],
    ['localFiles', 'Local file on disk (data/images/**)'],
  ]

  const results = missing.map((p) => {
    let direct = null, variant = null
    for (const [key, label] of ORDER) {
      const res = lookup(indexes[key], p.sku)
      if (!res) continue
      const rec = { source: label, how: res.how, ref: res.hit.ref, matchedId: res.hit.id }
      if (res.how === 'base-sku-variant') { if (!variant) variant = rec }
      else { direct = rec; break }
    }
    return {
      sku: p.sku,
      product_name: p.name,
      is_active: p.is_active,
      manually_hidden: p.manually_hidden,
      image_found: direct ? 'YES' : (variant ? 'VARIANT-ONLY' : 'NO'),
      match_type: direct ? direct.how : (variant ? variant.how : ''),
      source: direct ? direct.source : (variant ? variant.source : ''),
      matched_id: direct ? direct.matchedId : (variant ? variant.matchedId : ''),
      image_ref: direct ? direct.ref : (variant ? variant.ref : ''),
    }
  })

  const direct = results.filter((r) => r.image_found === 'YES')
  const variantOnly = results.filter((r) => r.image_found === 'VARIANT-ONLY')
  const none = results.filter((r) => r.image_found === 'NO')
  const directVisible = direct.filter((r) => r.is_active && !r.manually_hidden)

  console.log(`\n=== COVERAGE (of ${missing.length} catalog products missing image_url) ===`)
  console.log(`Direct image available (fillable now): ${direct.length} (${(direct.length / missing.length * 100).toFixed(1)}%)`)
  console.log(`  of which visible (active, not hidden): ${directVisible.length}`)
  console.log(`Sibling-variant only (needs visual confirm): ${variantOnly.length}`)
  console.log(`No image anywhere: ${none.length}`)

  const bySource = new Map()
  for (const r of direct) bySource.set(r.source, (bySource.get(r.source) || 0) + 1)
  console.log('\nDirect hits by source:')
  for (const [k, v] of [...bySource].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${v}`)

  const summaryRows = [
    { metric: 'Catalog products missing image_url', value: missing.length },
    { metric: 'Direct image available (fillable now)', value: direct.length },
    { metric: '  of which visible (active, not hidden)', value: directVisible.length },
    { metric: 'Sibling-variant only (needs visual confirm)', value: variantOnly.length },
    { metric: 'No image in any source', value: none.length },
    { metric: '', value: '' },
    { metric: '-- Direct hits by source --', value: '' },
    ...[...bySource].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ metric: k, value: v })),
  ]

  const wbOut = XLSX.utils.book_new()
  const mk = (data) => {
    const ws = XLSX.utils.json_to_sheet(data)
    ws['!cols'] = [{ wch: 16 }, { wch: 50 }, { wch: 10 }, { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 36 }, { wch: 18 }, { wch: 70 }]
    ws['!autofilter'] = { ref: ws['!ref'] }
    return ws
  }
  const sumWs = XLSX.utils.json_to_sheet(summaryRows)
  sumWs['!cols'] = [{ wch: 45 }, { wch: 22 }]
  XLSX.utils.book_append_sheet(wbOut, sumWs, 'Summary')
  XLSX.utils.book_append_sheet(wbOut, mk(direct), 'Fillable Now')
  XLSX.utils.book_append_sheet(wbOut, mk(variantOnly), 'Variant Only')
  XLSX.utils.book_append_sheet(wbOut, mk(none), 'No Image')

  fs.mkdirSync(path.dirname(OUT_XLSX), { recursive: true })
  XLSX.writeFile(wbOut, OUT_XLSX)
  console.log(`\nWrote ${path.relative(ROOT, OUT_XLSX)}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
