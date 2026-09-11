// backfill-product-measurements.mjs
// Run with: node scripts/backfill-product-measurements.mjs           (dry run)
//           node scripts/backfill-product-measurements.mjs --apply   (writes Supabase)
//
// Fills products.case_* from Erply, falling back to WooCommerce for the
// handful of SKUs Erply has no figures for. Requires migration 0045.
//
// Writes to Supabase ONLY. Nothing is sent to Erply or WooCommerce -- this
// pulls from them. (Pushing measurements back into Erply is a separate job
// and a riskier one; see the duplicate-customer incident in
// docs/memory/project-erply-duplicate-customer-incident.md for why an Erply
// write gets its own script and its own dry run.)
//
// UNITS: the case_*_in / case_weight_lb columns are inches and pounds, and so
// is the upstream data, so nothing is converted here. Read the header of
// migration 0045 before adding any conversion -- WooCommerce's store settings
// claim kg/cm and are wrong about the very values this script copies.
//
// Only the master carton is backfilled. Every measured product in Erply is a
// "N/pk" case and the figures are carton-level, so unit_* is left alone for
// hand entry. Rows already marked measurements_source='manual' are skipped
// entirely -- a hand measurement outranks the upstream number, and clobbering
// it would quietly undo warehouse work.
//
// Meant to run locally: Erply's API domain isn't allowlisted in a sandbox
// (same restriction as compare-erply-woo.mjs).

import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })

const APPLY = process.argv.includes('--apply')

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

const missingEnv = Object.entries({
  ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD, WOO_STORE_URL,
  WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET,
  NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
}).filter(([, v]) => !v).map(([k]) => k)
if (missingEnv.length > 0) {
  console.error(`Missing in .env.local: ${missingEnv.join(', ')}`)
  process.exit(1)
}

// Erply and Woo both spell "never filled in" as 0 or "", so a truthiness
// check would import zeros as real measurements. Migration 0045's check
// constraints would then reject the batch -- better to filter here.
function measurement(value) {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 100) / 100 // numeric(8,2)
}

// ── Erply ────────────────────────────────────────────────────────────────────

async function erplyPost(params) {
  const body = new URLSearchParams({ clientCode: ERPLY_CLIENT_CODE, ...params })
  const res = await fetch(`https://${ERPLY_CLIENT_CODE}.erply.com/api/`, { method: 'POST', body })
  if (!res.ok) throw new Error(`Erply HTTP ${res.status}`)
  const json = await res.json()
  if (json.status?.responseStatus === 'error') {
    throw new Error(`Erply error ${json.status.errorCode}: ${json.status.errorField ?? 'unknown'}`)
  }
  return json
}

async function fetchErply() {
  const auth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  const sessionKey = auth.records[0].sessionKey
  const all = []
  for (let pageNo = 1; ; pageNo++) {
    // getStockInfo deliberately omitted: it caps pages at 200 records and
    // this script needs none of it.
    const d = await erplyPost({
      request: 'getProducts', sessionKey,
      recordsOnPage: '300', pageNo: String(pageNo), active: '1',
    })
    const recs = d.records ?? []
    all.push(...recs)
    if (recs.length === 0 || all.length >= (d.status?.recordsTotal ?? 0)) break
  }
  const bySku = new Map()
  for (const p of all) {
    const sku = (p.code || '').trim()
    if (!sku) continue
    bySku.set(sku, {
      case_length_in: measurement(p.length),
      case_width_in: measurement(p.width),
      case_height_in: measurement(p.height),
      case_weight_lb: measurement(p.netWeight),
    })
  }
  return bySku
}

// ── WooCommerce ──────────────────────────────────────────────────────────────

async function fetchWoo() {
  const bySku = new Map()
  for (let pageNo = 1; ; pageNo++) {
    const url = `${WOO_STORE_URL}/wp-json/wc/v3/products?per_page=100&page=${pageNo}&status=any`
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${Buffer.from(`${WOO_CONSUMER_KEY}:${WOO_CONSUMER_SECRET}`).toString('base64')}` },
    })
    if (!res.ok) throw new Error(`WooCommerce HTTP ${res.status} on page ${pageNo}`)
    const batch = await res.json()
    for (const p of batch) {
      const sku = (p.sku ?? '').trim()
      if (!sku) continue
      bySku.set(sku, {
        case_length_in: measurement(p.dimensions?.length),
        case_width_in: measurement(p.dimensions?.width),
        case_height_in: measurement(p.dimensions?.height),
        case_weight_lb: measurement(p.weight),
      })
    }
    if (batch.length < 100) break
  }
  return bySku
}

// ── Supabase ─────────────────────────────────────────────────────────────────

const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

// Checked before the Erply/Woo fetches start: no reason to spend two minutes
// pulling 6,300 upstream records only to find the columns missing.
async function migrationApplied() {
  const { error } = await supabase.from('products').select('case_weight_lb').limit(1)
  if (!error) return true
  if (/case_weight_lb|column/.test(error.message)) return false
  throw new Error(error.message)
}

// Paginated: a plain select() stops at 1,000 rows and would silently skip
// two thirds of the catalog.
async function fetchCatalog() {
  const all = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('products')
      .select('id, sku, measurements_source, case_length_in, case_width_in, case_height_in, case_weight_lb')
      .eq('is_active', true)
      .order('sku')
      .range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    all.push(...data)
    if (data.length < pageSize) break
  }
  return all
}

const FIELDS = ['case_length_in', 'case_width_in', 'case_height_in', 'case_weight_lb']

// Everything runs inside main() so an early exit is a `return`. Calling
// process.exit() here instead tripped a libuv assertion on Windows
// ("!(handle->flags & UV_HANDLE_CLOSING)") by tearing down while the
// Supabase client still held an open handle -- harmless, but it printed
// after the message and looked like the script had crashed.
async function main() {
if (!(await migrationApplied())) {
  console.error('Columns missing -- apply supabase/migrations/0045_product_measurements.sql first.')
  process.exitCode = 1
  return
}

const [catalog, erply, woo] = await Promise.all([fetchCatalog(), fetchErply(), fetchWoo()])
console.log(`${catalog.length} active products; Erply has ${erply.size} SKUs, Woo ${woo.size}.`)

const updates = []
const stats = { fromErply: 0, fromWoo: 0, skippedManual: 0, noSource: 0, alreadyCurrent: 0 }

for (const row of catalog) {
  if (row.measurements_source === 'manual') { stats.skippedManual++; continue }

  const e = erply.get(row.sku)
  const w = woo.get(row.sku)
  // Per-field preference for Erply, then Woo. Field-by-field rather than
  // whole-record so a product Erply has dimensions but no weight for still
  // gets its weight from Woo -- they agree where both have data (0 of 3,160
  // fields differed by >2% on 2026-09-11), so mixing sources is safe.
  const next = {}
  let usedErply = false
  let usedWoo = false
  for (const field of FIELDS) {
    if (e?.[field] != null) { next[field] = e[field]; usedErply = true }
    else if (w?.[field] != null) { next[field] = w[field]; usedWoo = true }
  }

  if (Object.keys(next).length === 0) { stats.noSource++; continue }

  // Don't rewrite rows that already hold these numbers -- keeps re-runs cheap
  // and leaves measurements_updated_at meaningful.
  //
  // Compares only the fields `next` actually carries, because a field absent
  // upstream is never written and so can't be stale. Two earlier versions got
  // this wrong: comparing `Number(x ?? NaN)` made every partially-measured
  // product look stale forever (NaN !== NaN), and then comparing all four
  // fields did the same for any row where the DB holds a value upstream has
  // since dropped -- which really happens. Erply reported dimensions for 16
  // products at 20:29 on 2026-09-11 and `length="0"` for the same products
  // 20 minutes later. Measurements are only ever filled in here, never
  // nulled out, so once captured a value survives its source losing it.
  const same = (a, b) => (a == null ? null : Number(a)) === (b == null ? null : Number(b))
  const changedFields = Object.keys(next).filter((f) => !same(row[f], next[f]))
  if (changedFields.length === 0) { stats.alreadyCurrent++; continue }

  if (usedErply) stats.fromErply++
  else if (usedWoo) stats.fromWoo++

  updates.push({
    id: row.id,
    ...next,
    measurements_source: usedErply ? 'erply' : 'woo',
    measurements_updated_at: new Date().toISOString(),
    measurements_updated_by: 'backfill-product-measurements.mjs',
  })
}

const complete = updates.filter((u) => FIELDS.every((f) => u[f] != null)).length
console.table([
  { outcome: 'to update from Erply', count: stats.fromErply },
  { outcome: 'to update from Woo', count: stats.fromWoo },
  { outcome: '  ...of those, complete sets', count: complete },
  { outcome: 'already up to date', count: stats.alreadyCurrent },
  { outcome: 'skipped (hand-measured)', count: stats.skippedManual },
  { outcome: 'NO SOURCE - needs measuring', count: stats.noSource },
])

if (updates.length === 0) {
  console.log('Nothing to write.')
  return
}

if (!APPLY) {
  console.log('\nSample of what would be written:')
  console.table(updates.slice(0, 8).map((u) => ({
    id: u.id,
    dims: `${u.case_length_in ?? '-'} x ${u.case_width_in ?? '-'} x ${u.case_height_in ?? '-'} in`,
    weight: u.case_weight_lb != null ? `${u.case_weight_lb} lb` : '-',
    source: u.measurements_source,
  })))
  console.log(`\nDry run -- nothing written. Re-run with --apply to write ${updates.length} rows.`)
  return
}

// Per-row UPDATE, not a batched upsert. An id-only upsert payload looks like
// it should work -- PostgREST emits INSERT ... ON CONFLICT (id) DO UPDATE --
// but Postgres validates NOT NULL when the proposed tuple is formed, before
// conflict resolution runs, so it fails with `null value in column "sku"`
// and never reaches the DO UPDATE. Confirmed live 2026-09-11 (0 rows
// written). Padding the payload with sku/name/price to satisfy those
// constraints would mean this script could *insert* products, which is far
// worse than being slow. So: one UPDATE per row, a few in flight at a time.
const CONCURRENCY = 8
let written = 0
let failed = 0

async function writeRow(row) {
  const { id, ...fields } = row
  const { error } = await supabase.from('products').update(fields).eq('id', id)
  if (error) {
    if (failed === 0) console.error(`First failure (${id}): ${error.message}`)
    failed++
    return
  }
  written++
  if (written % 250 === 0) console.log(`  wrote ${written} / ${updates.length}`)
}

for (let i = 0; i < updates.length; i += CONCURRENCY) {
  await Promise.all(updates.slice(i, i + CONCURRENCY).map(writeRow))
}

console.log(`Done: ${written} products updated${failed > 0 ? `, ${failed} failed` : ''}.`)
if (failed > 0) {
  console.error('Re-running is safe -- rows already written are skipped as "already up to date".')
  process.exitCode = 1
}
}

await main()
