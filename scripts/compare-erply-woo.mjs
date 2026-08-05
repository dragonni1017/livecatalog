// compare-erply-woo.mjs
// Run with: node scripts/compare-erply-woo.mjs
//
// Read-only. Diffs Erply's active product catalog against WooCommerce's
// (ly-usa.com) product catalog by SKU. This is NOT the same comparison as
// scripts/check-erply-woo-health.mjs / list-erply-deactivate-candidates.mjs,
// which diff Erply against *this repo's* Supabase `products` table — the
// Erply<->WooCommerce sync itself lives in a separate integration, not in
// this repo (see docs/memory/project-erply-image-backfill.md, "the 172
// unmapped Woo products ... from the separate Erply->WooCommerce
// integration"). This script exists to re-derive that number (and get the
// actual SKU list) on demand instead of trusting a stale headcount.
//
// Meant to run locally, not in a sandbox: Erply's API domain isn't
// network-allowlisted there (same restriction as download-erply-images.mjs
// and the other Erply scripts). WooCommerce's REST API is normally reachable
// from anywhere, but keeping both calls in one script means one runtime
// requirement to remember.
//
// Requires in .env.local:
//   ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD   (existing)
//   WOO_STORE_URL       e.g. https://ly-usa.com (no trailing slash)
//   WOO_CONSUMER_KEY    WooCommerce -> Settings -> Advanced -> REST API -> Add key (Read access is enough)
//   WOO_CONSUMER_SECRET
//
// Writes:
//   data/erply-woo-review/erply-only.csv   - active in Erply, no matching Woo SKU
//   data/erply-woo-review/woo-only.csv     - published in Woo, no matching Erply SKU
//   data/erply-woo-review/mismatches.csv   - in both, but price and/or stock disagree
//   data/erply-woo-review/summary.txt      - counts, for pasting into a handoff doc
//
// Writes nothing to Erply, WooCommerce, or Supabase.
//
// Known limitation: WooCommerce variable products expose a SKU on each
// *variation*, not on the parent product, and fetching variations requires
// one extra API call per variable product. This first pass only reads the
// parent product's own `sku` field (empty for most variable products), so a
// variable-product parent will show as "Woo-side has no SKU" and won't match
// an Erply code even if a child variation actually carries it. If the
// mismatch counts look too high, that's the first thing to check --
// extending fetchWooProducts() to pull variations is the fix, not re-running
// this as-is.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

config({ path: path.join(ROOT, '.env.local') })

const ERPLY_CLIENT_CODE = process.env.ERPLY_CLIENT_CODE
const ERPLY_USERNAME = process.env.ERPLY_USERNAME
const ERPLY_PASSWORD = process.env.ERPLY_PASSWORD
const WOO_STORE_URL_RAW = process.env.WOO_STORE_URL
// Accept a bare domain (e.g. "ly-usa.com") as well as a full URL -- default
// to https:// and strip any trailing slash so it composes cleanly below.
const WOO_STORE_URL = WOO_STORE_URL_RAW
  ? (/^https?:\/\//i.test(WOO_STORE_URL_RAW) ? WOO_STORE_URL_RAW : `https://${WOO_STORE_URL_RAW}`).replace(/\/+$/, '')
  : WOO_STORE_URL_RAW
const WOO_CONSUMER_KEY = process.env.WOO_CONSUMER_KEY
const WOO_CONSUMER_SECRET = process.env.WOO_CONSUMER_SECRET

const missing = []
if (!ERPLY_CLIENT_CODE) missing.push('ERPLY_CLIENT_CODE')
if (!ERPLY_USERNAME) missing.push('ERPLY_USERNAME')
if (!ERPLY_PASSWORD) missing.push('ERPLY_PASSWORD')
if (!WOO_STORE_URL) missing.push('WOO_STORE_URL')
if (!WOO_CONSUMER_KEY) missing.push('WOO_CONSUMER_KEY')
if (!WOO_CONSUMER_SECRET) missing.push('WOO_CONSUMER_SECRET')
if (missing.length > 0) {
  console.error(`Missing in .env.local: ${missing.join(', ')}`)
  process.exit(1)
}

// ── Erply fetch (mirrors lib/erply.ts / check-erply-woo-health.mjs) ─────────

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

  // Same pagination gotcha as lib/erply.ts: Erply caps each page at 200
  // records whenever getStockInfo=1 is passed, regardless of recordsOnPage --
  // loop until the running count matches recordsTotal, don't precompute a
  // page count from a fixed page size.
  async function page(pageNo) {
    const data = await erplyPost({
      request: 'getProducts',
      sessionKey,
      recordsOnPage: '300',
      pageNo: String(pageNo),
      getStockInfo: '1',
      getImages: '1', // gated per docs/memory/project-erply-image-backfill.md -- expect empty, not absent
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

  return all.map((p) => {
    const stockQty = Object.values(p.warehouses ?? {}).reduce((sum, w) => sum + (w.totalInStock ?? 0), 0)
    return {
      sku: (p.code || String(p.productID)).trim(),
      // Run through the same stripHtml/typographic normalization as the Woo
      // side (function declaration below, hoisted) -- Erply's own raw text
      // can contain a literal en dash etc. too, not just Woo/WordPress's
      // entity-encoded version of one, and skipping this side produced a
      // false "name differs" mismatch (P273623, confirmed 2026-08-03).
      name: stripHtml(p.name),
      price: p.price ?? p.netPrice ?? 0,
      stockQty,
      categoryName: (p.groupName ?? '').trim(),
      description: stripHtml(p.description),
      hasImage: Array.isArray(p.images) && p.images.length > 0,
    }
  })
}

// Strip HTML and decode entities so a Woo field ("<p>Santa &amp; Snowman
// &#8211; 12/pk</p>") can be compared against Erply's plain-text one without
// every product showing a false "differs" purely from markup/encoding.
//
// WordPress's `wptexturize` also silently rewrites plain ASCII into
// "smart"/typographic characters on save (straight quotes -> curly quotes or
// primes, hyphens between numbers -> en dash, "x" between dimensions -> the
// multiplication sign) -- none of that is a real content difference from
// Erply's plain-text source, so it's normalized back to ASCII too. Confirmed
// live 2026-08-03: this is the entire reason the description-mismatch count
// dropped from 2870 -> 378 -> 77 as each pattern was found; don't assume 77
// is the floor without checking whether a new texturize pattern shows up.
const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function stripHtml(html) {
  const decoded = (html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m)

  return decoded
    .replace(/[‘’′]/g, "'")   // ' ' ′ -> '
    .replace(/[“”″]/g, '"')   // " " ″ -> "
    .replace(/[–—]/g, '-')          // – — -> -
    .replace(/×/g, 'x')                  // × -> x
    .replace(/…/g, '...')                // … -> ...
    .replace(/\s+/g, ' ')
    .trim()
}

// ── WooCommerce fetch ────────────────────────────────────────────────────────

function wooAuthHeader() {
  const token = Buffer.from(`${WOO_CONSUMER_KEY}:${WOO_CONSUMER_SECRET}`).toString('base64')
  return `Basic ${token}`
}

// Deliberately NOT status=publish only: confirmed live 2026-08-03 that the
// "172 unmapped Woo products" issue is 172 products sitting as *drafts*
// (created in one batch 2026-07-23, never published) -- a publish-only query
// silently excludes exactly the products this script exists to catch.
// WooCommerce's REST API rejects a comma-separated status list
// (rest_invalid_param) -- 'any' is the one value that works and already
// excludes trash (soft-deleted) on this store: confirmed status=any returns
// 3042, matching publish+draft+pending+private+future counted individually.
const WOO_STATUSES = 'any'

async function fetchWooProducts() {
  const perPage = 100
  let pageNo = 1
  const all = []
  while (true) {
    const url = `${WOO_STORE_URL}/wp-json/wc/v3/products?per_page=${perPage}&page=${pageNo}&status=${WOO_STATUSES}`
    const res = await fetch(url, { headers: { Authorization: wooAuthHeader() } })
    if (!res.ok) throw new Error(`WooCommerce HTTP ${res.status} on page ${pageNo}`)
    const batch = await res.json()
    if (!Array.isArray(batch) || batch.length === 0) break
    all.push(...batch)
    if (batch.length < perPage) break
    pageNo++
  }

  return all.map((p) => ({
    sku: (p.sku ?? '').trim(),
    // WordPress stores/returns titles with HTML entities intact (e.g.
    // "Santa &amp; Snowman") rather than decoded -- decode before comparing
    // against Erply's plain-text name, or every "&"/"<" in a name shows as a
    // false mismatch.
    name: stripHtml(p.name),
    price: p.price === '' || p.price == null ? null : Number(p.price),
    stockQty: p.manage_stock ? (p.stock_quantity ?? 0) : null,
    type: p.type, // 'simple' | 'variable' | ... -- see file header note on variations
    status: p.status, // 'publish' | 'draft' | 'pending' | 'private' | 'future'
    categoryNames: (p.categories ?? []).map((c) => c.name),
    // Confirmed live 2026-08-03: this store's sync writes Erply's
    // description into Woo's *short_description*, not `description` --
    // comparing against `description` alone made every product look like a
    // "missing description" false positive. Fall back to whichever is set.
    description: stripHtml(p.description) || stripHtml(p.short_description),
    hasImage: Array.isArray(p.images) && p.images.length > 0,
  }))
}

// ── CSV helpers (same convention as match-deactivate-candidates.mjs) ────────

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
  console.log('Fetching active Erply products...')
  const erplyProducts = await fetchErplyProducts()
  console.log(`  ${erplyProducts.length} active Erply products`)

  console.log('Fetching WooCommerce products (all non-trash statuses)...')
  const wooProducts = await fetchWooProducts()
  console.log(`  ${wooProducts.length} published Woo products`)

  const wooBySku = new Map(wooProducts.filter((p) => p.sku).map((p) => [p.sku, p]))
  const erplyBySku = new Map(erplyProducts.map((p) => [p.sku, p]))
  const wooSkusWithoutSku = wooProducts.filter((p) => !p.sku).length

  // Fields a sync integration is supposed to keep identical. Each check
  // returns true when the fields DIFFER (i.e. the sync missed something).
  // null on the Woo side means "field not applicable/not readable" (e.g.
  // manage_stock off) rather than "confirmed different" -- treated as no
  // diff, not a false positive.
  const norm = (s) => (s ?? '').trim().toLowerCase()

  function fieldDiffs(e, w) {
    const diffs = []
    if (Math.abs(w.price !== null ? w.price - e.price : 0) > 0.01 && w.price !== null) diffs.push('price')
    if (w.stockQty !== null && w.stockQty !== e.stockQty) diffs.push('stockQty')
    if (norm(w.name) !== norm(e.name)) diffs.push('name')
    if (!w.categoryNames.some((c) => norm(c) === norm(e.categoryName)) && (e.categoryName || w.categoryNames.length > 0)) {
      diffs.push('category')
    }
    if (e.hasImage !== w.hasImage) diffs.push('hasImage')
    // Now that description reads Woo's short_description (see
    // fetchWooProducts) and both sides run through the same stripHtml/entity
    // decode, a real text compare is meaningful rather than noise.
    if (norm(e.description) !== norm(w.description)) diffs.push('description')
    return diffs
  }

  const erplyOnly = []
  const mismatches = []
  for (const e of erplyProducts) {
    const w = wooBySku.get(e.sku)
    if (!w) {
      erplyOnly.push(e)
      continue
    }
    const diffs = fieldDiffs(e, w)
    if (diffs.length > 0) {
      mismatches.push({
        sku: e.sku,
        fieldsDiffering: diffs.join('|'),
        erplyName: e.name,
        wooName: w.name,
        erplyPrice: e.price,
        wooPrice: w.price,
        erplyStock: e.stockQty,
        wooStock: w.stockQty,
        erplyCategory: e.categoryName,
        wooCategory: w.categoryNames.join('; '),
        erplyHasImage: e.hasImage,
        wooHasImage: w.hasImage,
        erplyHasDescription: Boolean(e.description),
        wooHasDescription: Boolean(w.description),
      })
    }
  }

  const wooOnly = wooProducts.filter((w) => w.sku && !erplyBySku.has(w.sku))

  fs.mkdirSync(path.join(ROOT, 'data', 'erply-woo-review'), { recursive: true })

  writeCsv(
    path.join(ROOT, 'data', 'erply-woo-review', 'erply-only.csv'),
    ['sku', 'name', 'price', 'stockQty'],
    erplyOnly.map((p) => [p.sku, p.name, p.price, p.stockQty]),
  )

  writeCsv(
    path.join(ROOT, 'data', 'erply-woo-review', 'woo-only.csv'),
    ['sku', 'name', 'price', 'stockQty', 'type', 'status'],
    wooOnly.map((p) => [p.sku, p.name, p.price, p.stockQty, p.type, p.status]),
  )

  writeCsv(
    path.join(ROOT, 'data', 'erply-woo-review', 'mismatches.csv'),
    [
      'sku', 'fieldsDiffering',
      'erplyName', 'wooName',
      'erplyPrice', 'wooPrice',
      'erplyStock', 'wooStock',
      'erplyCategory', 'wooCategory',
      'erplyHasImage', 'wooHasImage',
      'erplyHasDescription', 'wooHasDescription',
    ],
    mismatches.map((m) => [
      m.sku, m.fieldsDiffering,
      m.erplyName, m.wooName,
      m.erplyPrice, m.wooPrice,
      m.erplyStock, m.wooStock,
      m.erplyCategory, m.wooCategory,
      m.erplyHasImage, m.wooHasImage,
      m.erplyHasDescription, m.wooHasDescription,
    ]),
  )

  const fieldCounts = {}
  for (const m of mismatches) {
    for (const f of m.fieldsDiffering.split('|')) fieldCounts[f] = (fieldCounts[f] ?? 0) + 1
  }

  const summary = [
    `Erply vs WooCommerce comparison — ${new Date().toISOString()}`,
    ``,
    `Active Erply products:        ${erplyProducts.length}`,
    `Woo products (publish/draft/pending/private/future, excl. trash): ${wooProducts.length} (${wooSkusWithoutSku} with no SKU set on the parent -- see script header re: variable products)`,
    ``,
    `In Erply, no matching Woo SKU:  ${erplyOnly.length}  -> erply-only.csv`,
    `In Woo, no matching Erply SKU:  ${wooOnly.length}  -> woo-only.csv`,
    `In both, at least one field disagrees: ${mismatches.length}  -> mismatches.csv`,
    ...(Object.keys(fieldCounts).length > 0
      ? ['', 'Mismatches by field:', ...Object.entries(fieldCounts).sort((a, b) => b[1] - a[1]).map(([f, n]) => `  ${f}: ${n}`)]
      : []),
  ].join('\n')

  fs.writeFileSync(path.join(ROOT, 'data', 'erply-woo-review', 'summary.txt'), summary + '\n')

  console.log('\n' + summary)
  console.log('\nWrote data/erply-woo-review/{erply-only,woo-only,mismatches}.csv + summary.txt')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
