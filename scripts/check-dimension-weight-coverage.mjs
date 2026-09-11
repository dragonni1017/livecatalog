// check-dimension-weight-coverage.mjs
// Run with: node scripts/check-dimension-weight-coverage.mjs
//
// Read-only. Answers one question before any schema work happens: how many
// products already have dimensions/weight *somewhere* upstream, and how many
// would have to be measured by hand?
//
// As of 2026-09-11 this repo has no weight/dimension concept at all -- no
// column in `products` (nothing in migrations 0001-0044), no field on the
// `Product` type, and lib/erply.ts's ErplyProduct interface doesn't request
// or parse any. So the only possible sources are the two upstream systems.
//
// Deliberately does NOT hard-code the Erply field names. Erply's getProducts
// response varies by account/plan, and guessing wrong would report 0%
// coverage that looks like "no data" instead of "wrong key" -- the same class
// of silent-empty mistake as the RLS and role=all gotchas in CLAUDE.md. It
// discovers every key matching /weight|length|width|height|dimension|volume/
// from real records first, prints them, and only then counts coverage.
//
// Meant to run locally: Erply's API domain isn't allowlisted in a sandbox
// (same restriction as compare-erply-woo.mjs and the other Erply scripts).
//
// Requires in .env.local: ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD,
// WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET,
// NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Writes nothing to Erply, WooCommerce, or Supabase.

import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })

const {
  ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD,
  WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET,
  NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
} = process.env

const WOO_STORE_URL = (() => {
  const raw = process.env.WOO_STORE_URL
  if (!raw) return raw
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
  return withScheme.replace(/\/+$/, '')
})()

const missing = Object.entries({
  ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD, WOO_STORE_URL,
  WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET,
  NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
}).filter(([, v]) => !v).map(([k]) => k)
if (missing.length > 0) {
  console.error(`Missing in .env.local: ${missing.join(', ')}`)
  process.exit(1)
}

// Any key that could plausibly carry a physical measurement. Matched against
// real response keys rather than assumed to exist.
const MEASUREMENT_KEY = /weight|length|width|height|depth|dimension|volume|cbm|size/i

// Erply's `lengthInMinutes` (duration of a service item) matches /length/ but
// is not a physical dimension, and it is 0 on all 3,076 products here. Left
// out of the completeness maths -- counting it once made Erply report 0/3076
// complete when the real figure is in the low thousands.
const NOT_A_DIMENSION = /lengthInMinutes/i

// A measurement counts as "present" only if it's a number > 0. Erply and Woo
// both represent "never filled in" as 0 or "" rather than null, so a plain
// truthiness/null check would score every unmeasured product as measured.
function hasValue(v) {
  if (v === null || v === undefined || v === '') return false
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  return Number.isFinite(n) && n > 0
}

// -- Erply -------------------------------------------------------------------

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

  // No getStockInfo/getImages here: this probe only needs the product's own
  // fields, and omitting getStockInfo lifts Erply's 200-record page cap
  // (see the pagination note in lib/erply.ts).
  async function page(pageNo) {
    const data = await erplyPost({
      request: 'getProducts', sessionKey,
      recordsOnPage: '300', pageNo: String(pageNo), active: '1',
    })
    return { products: data.records ?? [], total: data.status.recordsTotal ?? 0 }
  }

  const first = await page(1)
  const all = [...first.products]
  let pageNo = 2
  while (all.length < first.total) {
    const { products } = await page(pageNo)
    if (products.length === 0) break
    all.push(...products)
    pageNo++
  }
  return all
}

// -- WooCommerce -------------------------------------------------------------

function wooAuthHeader() {
  return `Basic ${Buffer.from(`${WOO_CONSUMER_KEY}:${WOO_CONSUMER_SECRET}`).toString('base64')}`
}

// status=any for the same reason as compare-erply-woo.mjs: a publish-only
// query silently drops the ~172 draft products.
async function fetchWooProducts() {
  const all = []
  let pageNo = 1
  while (true) {
    const url = `${WOO_STORE_URL}/wp-json/wc/v3/products?per_page=100&page=${pageNo}&status=any`
    const res = await fetch(url, { headers: { Authorization: wooAuthHeader() } })
    if (!res.ok) throw new Error(`WooCommerce HTTP ${res.status} on page ${pageNo}`)
    const batch = await res.json()
    if (batch.length === 0) break
    all.push(...batch)
    if (batch.length < 100) break
    pageNo++
  }
  return all
}

// -- Reporting ---------------------------------------------------------------

// Flattens one level so Woo's `dimensions: {length, width, height}` object is
// counted per-field instead of as one always-present key.
function measurementFields(record) {
  const out = {}
  for (const [key, value] of Object.entries(record)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [sub, subValue] of Object.entries(value)) {
        if (MEASUREMENT_KEY.test(key) || MEASUREMENT_KEY.test(sub)) out[`${key}.${sub}`] = subValue
      }
    } else if (MEASUREMENT_KEY.test(key)) {
      out[key] = value
    }
  }
  return out
}

function report(label, records) {
  console.log(`\n=== ${label}: ${records.length} products ===`)
  if (records.length === 0) return

  const keys = new Set()
  for (const r of records) for (const k of Object.keys(measurementFields(r))) keys.add(k)

  if (keys.size === 0) {
    console.log('  No measurement-shaped fields in the response at all.')
    return
  }

  const rows = [...keys].sort().map((key) => {
    let filled = 0
    const samples = []
    for (const r of records) {
      const v = measurementFields(r)[key]
      if (hasValue(v)) {
        filled++
        if (samples.length < 3) samples.push(v)
      }
    }
    const pct = ((filled / records.length) * 100).toFixed(1)
    return { field: key, filled, pct: `${pct}%`, samples: samples.join(', ') || '-' }
  })
  console.table(rows)

  // How many products have a *complete* set (every dimension + a weight)?
  // That's the number that could feed a carrier rate quote with no manual work.
  const dimKeys = [...keys].filter((k) => /length|width|height|depth/i.test(k) && !NOT_A_DIMENSION.test(k))
  const weightKeys = [...keys].filter((k) => /weight/i.test(k))
  if (dimKeys.length > 0 && weightKeys.length > 0) {
    let complete = 0
    for (const r of records) {
      const f = measurementFields(r)
      const allDims = dimKeys.every((k) => hasValue(f[k]))
      const anyWeight = weightKeys.some((k) => hasValue(f[k]))
      if (allDims && anyWeight) complete++
    }
    console.log(`  Complete (${dimKeys.join(' + ')} + a weight): ${complete} / ${records.length}`)
  }
}

// Normalizes one record from either system into the same shape, so the two
// can be joined by SKU and compared. Returns null for the measurements that
// system doesn't have rather than 0 -- "not measured" and "measured as zero"
// have to stay distinguishable.
function normalize(record, source) {
  const pick = (v) => (hasValue(v) ? Number(v) : null)
  if (source === 'erply') {
    return {
      sku: (record.code || String(record.productID)).trim(),
      length: pick(record.length),
      width: pick(record.width),
      height: pick(record.height),
      weight: pick(record.netWeight),
    }
  }
  return {
    sku: (record.sku ?? '').trim(),
    length: pick(record.dimensions?.length),
    width: pick(record.dimensions?.width),
    height: pick(record.dimensions?.height),
    weight: pick(record.weight),
  }
}

const isComplete = (m) => m != null && m.length != null && m.width != null && m.height != null && m.weight != null

// The unit each system stores these in. Nothing in either API response says
// so -- Woo keeps it in store settings, Erply in account config -- and
// mixing lb with kg or cm with in would corrupt every rate quote built on
// this data, so it gets printed rather than assumed.
async function fetchWooUnits() {
  const res = await fetch(`${WOO_STORE_URL}/wp-json/wc/v3/settings/products`, {
    headers: { Authorization: wooAuthHeader() },
  })
  if (!res.ok) return null
  const settings = await res.json()
  const get = (id) => settings.find((s) => s.id === id)?.value ?? '?'
  return { weight: get('woocommerce_weight_unit'), dimension: get('woocommerce_dimension_unit') }
}

const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// Paginated: Supabase caps a single select at 1,000 rows, so a plain
// select() here would silently describe only the first third of the catalog.
//
// Returns both scopes, because they differ a lot and the right denominator is
// a business call: 3,222 products are is_active, but 2,029 of those are
// manually_hidden (confirmed not a null-filter artifact -- zero rows have
// manually_hidden null), leaving 1,193 actually on the storefront.
async function fetchSupabaseSkus() {
  const all = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('products').select('sku, manually_hidden')
      .eq('is_active', true)
      .order('sku').range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    all.push(...data)
    if (data.length < pageSize) break
  }
  const clean = all.filter((r) => (r.sku ?? '').trim())
  return {
    visible: clean.filter((r) => r.manually_hidden === false).map((r) => r.sku.trim()),
    allActive: clean.map((r) => r.sku.trim()),
  }
}

const [skus, erply, woo, wooUnits] = await Promise.all([
  fetchSupabaseSkus(),
  fetchErplyProducts().catch((e) => { console.error(`Erply fetch failed: ${e.message}`); return [] }),
  fetchWooProducts().catch((e) => { console.error(`WooCommerce fetch failed: ${e.message}`); return [] }),
  fetchWooUnits().catch(() => null),
])

console.log(`Supabase: ${skus.allActive.length} active products, ${skus.visible.length} of them publicly visible.`)
report('Erply', erply)
report('WooCommerce', woo)

// -- Cross-system join ------------------------------------------------------

const erplyBySku = new Map(erply.map((r) => normalize(r, 'erply')).filter((m) => m.sku).map((m) => [m.sku, m]))
const wooBySku = new Map(woo.map((r) => normalize(r, 'woo')).filter((m) => m.sku).map((m) => [m.sku, m]))

console.log(`\nUnits -- Woo: ${wooUnits ? `${wooUnits.weight} / ${wooUnits.dimension}` : 'could not read settings'}; Erply: not exposed by getProducts, check account config.`)

function bucketize(catalogSkus) {
  const buckets = { both: [], erplyOnly: [], wooOnly: [], neither: [] }
  for (const sku of catalogSkus) {
    const e = isComplete(erplyBySku.get(sku))
    const w = isComplete(wooBySku.get(sku))
    if (e && w) buckets.both.push(sku)
    else if (e) buckets.erplyOnly.push(sku)
    else if (w) buckets.wooOnly.push(sku)
    else buckets.neither.push(sku)
  }
  return buckets
}

function reportCoverage(label, catalogSkus) {
  const buckets = bucketize(catalogSkus)
  const pct = (n) => `${((n / catalogSkus.length) * 100).toFixed(1)}%`
  console.log(`\n=== Coverage against ${catalogSkus.length} ${label} SKUs ===`)
  console.table([
    { source: 'complete in both', count: buckets.both.length, pct: pct(buckets.both.length) },
    { source: 'complete in Erply only', count: buckets.erplyOnly.length, pct: pct(buckets.erplyOnly.length) },
    { source: 'complete in Woo only', count: buckets.wooOnly.length, pct: pct(buckets.wooOnly.length) },
    { source: 'MISSING everywhere', count: buckets.neither.length, pct: pct(buckets.neither.length) },
  ])
  const fillable = buckets.both.length + buckets.erplyOnly.length + buckets.wooOnly.length
  console.log(`Backfillable from upstream with no measuring: ${fillable} / ${catalogSkus.length} (${pct(fillable)})`)
  return buckets
}

reportCoverage('active', skus.allActive)
const visibleBuckets = reportCoverage('publicly visible', skus.visible)

// Where both systems have a complete set, do they agree? A systematic ratio
// (2.2 ~ lb/kg, 2.54 ~ in/cm) means one side needs converting, not that the
// data is wrong -- which is why the ratio is printed and not just a count.
const disagreements = []
for (const sku of visibleBuckets.both) {
  const e = erplyBySku.get(sku)
  const w = wooBySku.get(sku)
  for (const field of ['length', 'width', 'height', 'weight']) {
    const ratio = w[field] / e[field]
    if (Math.abs(ratio - 1) > 0.02) disagreements.push({ sku, field, erply: e[field], woo: w[field], ratio: ratio.toFixed(3) })
  }
}
console.log(`\nFields disagreeing by >2% where both systems have data: ${disagreements.length} / ${visibleBuckets.both.length * 4}`)
if (disagreements.length > 0) {
  const byRatio = new Map()
  for (const d of disagreements) {
    const key = Number(d.ratio).toFixed(1)
    byRatio.set(key, (byRatio.get(key) ?? 0) + 1)
  }
  console.log('Most common woo/erply ratios (a clustered value = a unit difference, scattered = real data drift):')
  console.table([...byRatio.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([ratio, count]) => ({ ratio, count })))
  console.log('Sample disagreements:')
  console.table(disagreements.slice(0, 10))
}
