// find-truly-missing-images.mjs
// Run with: node scripts/find-truly-missing-images.mjs
//
// Read-only. Cross-checks every SKU active in Erply or listed in WooCommerce
// against all FOUR known image sources for this catalog:
//   1. Erply           (getProducts getImages=1 -- live fetch)
//   2. WooCommerce      (ly-usa.com wc/v3 -- live fetch)
//   3. Cloudinary/Supabase (this repo's own image store -- products.image_url)
//   4. GoDaddy archive  (data/images/recent-3mo-images/ + its mapping CSV --
//      the pre-Woo/pre-Erply historical export, see
//      scripts/download-godaddy-backfill-images.mjs)
//
// This re-derives (and supersedes) the erplyHasImage/wooHasImage columns
// scripts/compare-erply-woo.mjs writes into mismatches.csv -- that script
// only surfaces hasImage as a "mismatch" when Erply and Woo DISAGREE (one
// has an image, the other doesn't); a SKU where BOTH sides have no image
// never shows up there, which is exactly the case this script exists to
// find. Run compare-erply-woo.mjs too if you also want the other field
// diffs (price/stock/name/etc) -- this script only looks at images.
//
// Meant to run locally (same requirement as compare-erply-woo.mjs /
// download-erply-images.mjs -- Erply's API domain isn't reachable from a
// sandboxed environment).
//
// Requires in .env.local:
//   ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD
//   WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Writes:
//   data/images/image-source-matrix.csv   - every SKU, one column per source (1/0), for auditing
//   data/images/genuinely-no-image.csv    - sku,name only, for the SKUs with NO image anywhere
//
// Writes nothing to Erply, WooCommerce, Supabase, or Cloudinary.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

config({ path: path.join(ROOT, '.env.local') })

const ERPLY_CLIENT_CODE = process.env.ERPLY_CLIENT_CODE
const ERPLY_USERNAME = process.env.ERPLY_USERNAME
const ERPLY_PASSWORD = process.env.ERPLY_PASSWORD
const WOO_STORE_URL_RAW = process.env.WOO_STORE_URL
const WOO_STORE_URL = WOO_STORE_URL_RAW
  ? (/^https?:\/\//i.test(WOO_STORE_URL_RAW) ? WOO_STORE_URL_RAW : `https://${WOO_STORE_URL_RAW}`).replace(/\/+$/, '')
  : WOO_STORE_URL_RAW
const WOO_CONSUMER_KEY = process.env.WOO_CONSUMER_KEY
const WOO_CONSUMER_SECRET = process.env.WOO_CONSUMER_SECRET
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const missing = []
if (!ERPLY_CLIENT_CODE) missing.push('ERPLY_CLIENT_CODE')
if (!ERPLY_USERNAME) missing.push('ERPLY_USERNAME')
if (!ERPLY_PASSWORD) missing.push('ERPLY_PASSWORD')
if (!WOO_STORE_URL) missing.push('WOO_STORE_URL')
if (!WOO_CONSUMER_KEY) missing.push('WOO_CONSUMER_KEY')
if (!WOO_CONSUMER_SECRET) missing.push('WOO_CONSUMER_SECRET')
if (!SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL')
if (!SUPABASE_SERVICE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')
if (missing.length > 0) {
  console.error(`Missing in .env.local: ${missing.join(', ')}`)
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ── Erply fetch (mirrors compare-erply-woo.mjs) ─────────────────────────────

const ERPLY_API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`

async function erplyPost(params) {
  const body = new URLSearchParams({ clientCode: ERPLY_CLIENT_CODE, ...params })
  const res = await fetch(ERPLY_API_URL, { method: 'POST', body })
  if (!res.ok) throw new Error(`Erply HTTP ${res.status}`)
  const json = await res.json()
  if (json.status?.responseStatus === 'error') {
    throw new Error(`Erply error ${json.status.errorCode}: ${json.status.errorField ?? 'unknown'}`)
  }
  return json
}

async function fetchErplyProducts() {
  const auth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  const sessionKey = auth.records[0].sessionKey

  async function page(pageNo) {
    const data = await erplyPost({
      request: 'getProducts',
      sessionKey,
      recordsOnPage: '300',
      pageNo: String(pageNo),
      getImages: '1',
      active: '1',
    })
    return { products: data.records, total: data.status.recordsTotal ?? 0 }
  }

  const first = await page(1)
  const all = [...first.products]
  const total = first.total
  let pageNo = 2
  while (all.length < total) {
    const { products } = await page(pageNo)
    if (products.length === 0) break
    all.push(...products)
    pageNo++
  }

  return all.map((p) => ({
    sku: (p.code || String(p.productID)).trim(),
    name: (p.name ?? '').trim(),
    hasImage: Array.isArray(p.images) && p.images.length > 0,
  }))
}

// ── WooCommerce fetch (mirrors compare-erply-woo.mjs) ───────────────────────

function wooAuthHeader() {
  const token = Buffer.from(`${WOO_CONSUMER_KEY}:${WOO_CONSUMER_SECRET}`).toString('base64')
  return `Basic ${token}`
}

async function fetchWooProducts() {
  const perPage = 100
  let pageNo = 1
  const all = []
  while (true) {
    const url = `${WOO_STORE_URL}/wp-json/wc/v3/products?per_page=${perPage}&page=${pageNo}&status=any`
    const res = await fetch(url, { headers: { Authorization: wooAuthHeader() } })
    if (!res.ok) throw new Error(`WooCommerce HTTP ${res.status} on page ${pageNo}`)
    const batch = await res.json()
    if (!Array.isArray(batch) || batch.length === 0) break
    all.push(...batch)
    if (batch.length < perPage) break
    pageNo++
  }
  return all
    .filter((p) => p.sku)
    .map((p) => ({
      sku: p.sku.trim(),
      name: (p.name ?? '').trim(),
      hasImage: Array.isArray(p.images) && p.images.length > 0,
    }))
}

// ── Supabase / Cloudinary ───────────────────────────────────────────────────

async function fetchSupabaseImageStatus() {
  const bySku = new Map()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('products')
      .select('sku, name, image_url')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`Supabase: ${error.message}`)
    for (const row of data) {
      if (!row.sku) continue
      bySku.set(row.sku.trim().toUpperCase(), {
        name: row.name ?? '',
        hasImage: Boolean(row.image_url),
      })
    }
    if (data.length < PAGE) break
  }
  return bySku
}

// ── GoDaddy archive (local filesystem) ──────────────────────────────────────
// Two things count as "has a godaddy image": a file actually downloaded to
// disk (recent-3mo-images/<SKU>.<ext>), or an entry in the mapping CSV that
// records a successful download (same info, belt-and-suspenders in case the
// file was moved/renamed after the CSV was written).

function parseCsvLine(line) {
  const fields = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else { inQuotes = false }
      } else {
        cur += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      fields.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  fields.push(cur)
  return fields
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0)
  const header = parseCsvLine(lines[0])
  return lines.slice(1).map((line) => {
    const cols = parseCsvLine(line)
    const row = {}
    header.forEach((h, i) => (row[h] = cols[i]))
    return row
  })
}

function loadLocalImageArchiveSkus(imagesDir, mappingCsvPath) {
  const skus = new Set()
  if (fs.existsSync(imagesDir)) {
    for (const f of fs.readdirSync(imagesDir)) {
      skus.add(path.parse(f).name.toUpperCase())
    }
  }
  if (mappingCsvPath && fs.existsSync(mappingCsvPath)) {
    for (const row of parseCsv(fs.readFileSync(mappingCsvPath, 'utf8'))) {
      if (row.sku) skus.add(row.sku.trim().toUpperCase())
    }
  }
  return skus
}

// ── CSV output ───────────────────────────────────────────────────────────────

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function writeCsv(outPath, header, rows) {
  const lines = [header.join(','), ...rows.map((r) => r.map(csvEscape).join(','))]
  fs.writeFileSync(outPath, lines.join('\n') + '\n')
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Fetching active Erply products (with image status)...')
  const erplyProducts = await fetchErplyProducts()
  console.log(`  ${erplyProducts.length} active Erply products`)

  console.log('Fetching WooCommerce products (with image status)...')
  const wooProducts = await fetchWooProducts()
  console.log(`  ${wooProducts.length} Woo products with a SKU`)

  console.log('Fetching Cloudinary/Supabase image status...')
  const supabaseBySku = await fetchSupabaseImageStatus()
  console.log(`  ${supabaseBySku.size} products in Supabase`)

  console.log('Scanning local GoDaddy archive...')
  const godaddySkus = loadLocalImageArchiveSkus(
    path.join(ROOT, 'data', 'images', 'recent-3mo-images'),
    path.join(ROOT, 'data', 'images', 'recent-3mo-image-mapping.csv'),
  )
  console.log(`  ${godaddySkus.size} SKUs with a downloaded GoDaddy-archive image on disk`)

  // Also fold in the Erply-images local archive if it exists (a prior
  // download-erply-images.mjs run) -- harmless if the dir/CSV don't exist yet.
  const erplyLocalSkus = loadLocalImageArchiveSkus(
    path.join(ROOT, 'data', 'images', 'erply-images'),
    path.join(ROOT, 'data', 'images', 'erply-image-mapping.csv'),
  )

  const erplyBySku = new Map(erplyProducts.map((p) => [p.sku.toUpperCase(), p]))
  const wooBySku = new Map(wooProducts.map((p) => [p.sku.toUpperCase(), p]))

  // Union of every SKU we know about from Erply (active) or Woo (any status).
  const allSkus = new Set([...erplyBySku.keys(), ...wooBySku.keys()])

  const rows = []
  const noImageAnywhere = []

  for (const skuUpper of allSkus) {
    const e = erplyBySku.get(skuUpper)
    const w = wooBySku.get(skuUpper)
    const s = supabaseBySku.get(skuUpper)
    const name = e?.name || w?.name || s?.name || ''

    const inErply = Boolean(e)
    const inWoo = Boolean(w)
    const erplyHasImage = Boolean(e?.hasImage)
    const wooHasImage = Boolean(w?.hasImage)
    const cloudinaryHasImage = Boolean(s?.hasImage)
    const godaddyHasImage = godaddySkus.has(skuUpper) || erplyLocalSkus.has(skuUpper)

    const genuinelyNoImage = !erplyHasImage && !wooHasImage && !cloudinaryHasImage && !godaddyHasImage

    rows.push([
      skuUpper, name, inErply ? 1 : 0, inWoo ? 1 : 0,
      erplyHasImage ? 1 : 0, wooHasImage ? 1 : 0, cloudinaryHasImage ? 1 : 0, godaddyHasImage ? 1 : 0,
      genuinelyNoImage ? 1 : 0,
    ])

    if (genuinelyNoImage) noImageAnywhere.push([skuUpper, name])
  }

  rows.sort((a, b) => a[0].localeCompare(b[0]))
  noImageAnywhere.sort((a, b) => a[0].localeCompare(b[0]))

  fs.mkdirSync(path.join(ROOT, 'data', 'images'), { recursive: true })

  writeCsv(
    path.join(ROOT, 'data', 'images', 'image-source-matrix.csv'),
    ['sku', 'name', 'inErply', 'inWoo', 'erplyHasImage', 'wooHasImage', 'cloudinaryHasImage', 'godaddyHasImage', 'genuinelyNoImage'],
    rows,
  )

  writeCsv(
    path.join(ROOT, 'data', 'images', 'genuinely-no-image.csv'),
    ['sku', 'name'],
    noImageAnywhere,
  )

  console.log(`\nTotal SKUs checked (union of active Erply + any-status Woo): ${allSkus.size}`)
  console.log(`Genuinely no image in Erply, Woo, Cloudinary/Supabase, or the GoDaddy archive: ${noImageAnywhere.length}`)
  console.log('\nWrote data/images/image-source-matrix.csv (full audit trail)')
  console.log('Wrote data/images/genuinely-no-image.csv (hand this to whoever is taking photos)')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
