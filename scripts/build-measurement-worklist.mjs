// build-measurement-worklist.mjs
// Run with: node scripts/build-measurement-worklist.mjs
//
// Read-only. Builds the "what still needs physically measuring" worklist for
// warehouse bin capacity planning, as a fill-in-able xlsx.
//
// After the 2026-09-11 backfill, of 3,222 active products 2,209 have
// plausible master-carton figures, 27 have figures that can't be real, and
// 986 have nothing at all. Nobody can code their way out of that last
// number -- someone has to put a tape measure and a scale on a carton -- so
// this produces the list, split by what's worth doing first, with empty
// columns to write into. Re-run it any time; the counts come from live data,
// not from this comment.
//
// Sheets, in the order they should be worked:
//   1. Implausible - Recheck    -- figures exist but are physically
//                                  impossible, so they look done and aren't.
//                                  Most dangerous, smallest list.
//   2. Visible - Need Case      -- on the storefront AND no carton figures
//                                  anywhere.
//   3. Hidden - Need Case       -- active but manually_hidden; same gap, but
//                                  no customer sees these.
//   4. Summary                  -- the counts, for pasting into a handoff.
//
// Fill in the four Case columns and hand the file to
// scripts/import-measurement-worklist.mjs to write it back.
//
// Per-piece (unit_*) measurements are deliberately NOT listed. Decided
// 2026-09-11: bins hold sealed cases, so carton figures are the whole job.
// The unit_* columns exist in the schema as headroom and stay empty; a
// "Need Unit Measurement" sheet was dropped from this script because it
// listed 2,209 products nobody intends to measure.
//
// UNITS ARE INCHES AND POUNDS. Column headers say so, because the source
// data is imperial while WooCommerce's store settings declare kg/cm -- see
// migration 0045's header. Do not let anyone fill this in in centimetres.
//
// Reads measurements from Supabase's case_* columns once migration 0045 is
// applied (so hand-entered values are respected and the list shrinks as work
// gets done), and falls back to reading Erply/Woo directly before then.
//
// Writes: data/measurement-worklist.xlsx. Writes nothing to any system.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

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

const missingEnv = Object.entries({
  ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD, WOO_STORE_URL,
  WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET,
  NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
}).filter(([, v]) => !v).map(([k]) => k)
if (missingEnv.length > 0) {
  console.error(`Missing in .env.local: ${missingEnv.join(', ')}`)
  process.exit(1)
}

const supabase = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

function measurement(value) {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  return Number.isFinite(n) && n > 0 ? n : null
}

// Upstream data contains values that pass a `> 0` check but cannot describe a
// real carton, and a capacity plan built on them would allocate stock that
// physically will not fit. Two tests, both found live on 2026-09-11:
//
//   - A dimension under an inch. 26 products carry a dimension of exactly
//     0.2 (all floral/wrapping paper) -- one repeated placeholder, not 26
//     measurements.
//   - Density above lead (0.41 lb/in3). 5 products, e.g. D751087 "Large 3D
//     Printed Gear Ball" at 94.8 lb in 1.2 x 2 x 17 in = 2.3 lb/in3, denser
//     than any material that exists.
//
// These get their own sheet and are NOT counted as measured, so they're
// re-measured rather than trusted.
//
// Kept identical to implausible() in
// scripts/import-measurement-worklist.mjs -- if the two disagree, this
// script can flag a carton the importer would happily accept back, or vice
// versa. The absolute bounds come from the real distribution of the 2,244
// backfilled cartons (weight p50 30.9 / p99 64 / max 189.6 lb; dimensions
// p50 18 / p99 49 in), so they reject typos, not stock.
//
// Note a metric sheet is NOT detectable: cm+kg entry lands around 0.0002
// lb/in3 and real bulky-light products (artificial flowers, ribbon) start at
// 0.00002 with p1 at 0.00014, so the ranges overlap and no density floor can
// separate them.
const LEAD_LB_PER_IN3 = 0.41
const MAX_WEIGHT_LB = 250
const MAX_DIMENSION_IN = 120

function implausible(v) {
  const dims = [v.case_length_in, v.case_width_in, v.case_height_in]

  const tiny = dims.filter((d) => d != null && d < 1)
  if (tiny.length > 0) return `dimension under 1 inch (${tiny.join(', ')}) -- likely a placeholder`

  const huge = dims.filter((d) => d != null && d > MAX_DIMENSION_IN)
  if (huge.length > 0) return `dimension over ${MAX_DIMENSION_IN} in (${huge.join(', ')})`

  if (v.case_weight_lb != null && v.case_weight_lb > MAX_WEIGHT_LB) {
    return `weight over ${MAX_WEIGHT_LB} lb (${v.case_weight_lb})`
  }

  if (dims.every((d) => d != null) && v.case_weight_lb != null) {
    const density = v.case_weight_lb / (dims[0] * dims[1] * dims[2])
    if (density > LEAD_LB_PER_IN3) return `impossible density (${density.toFixed(2)} lb/in3, denser than lead)`
  }
  return null
}

// Mirrors lib/pack.ts extractUnitsPerCase, which is TypeScript and can't be
// imported into a plain .mjs script. Kept to the same two rules: an explicit
// "cs.N" wins, otherwise per-pack x packs-per-case.
function unitsPerCase(name) {
  const spec = (name ?? '').match(/\d+\s*\/\s*pk\b[^]*?\d+\s*bx\s*\/\s*cs(?:\s*cs\.\d+)?/i)?.[0]
  if (!spec) return ''
  const explicit = spec.match(/cs\.(\d+)/i)?.[1]
  if (explicit) return Number(explicit)
  const perPack = Number(spec.match(/(\d+)\s*\/\s*pk/i)?.[1] ?? 0)
  const packsPerCase = Number(spec.match(/(\d+)\s*bx\s*\/\s*cs/i)?.[1] ?? 0)
  return perPack * packsPerCase || ''
}

function packSpec(name) {
  return (name ?? '').match(/\d+\s*\/\s*pk\b[^]*?\d+\s*bx\s*\/\s*cs(?:\s*cs\.\d+)?/i)?.[0]?.replace(/\s+/g, ' ').trim() ?? ''
}

// ── upstream sources (fallback before migration 0045 is applied) ────────────

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
  const bySku = new Map()
  for (let pageNo = 1; ; pageNo++) {
    const d = await erplyPost({ request: 'getProducts', sessionKey, recordsOnPage: '300', pageNo: String(pageNo), active: '1' })
    const recs = d.records ?? []
    for (const p of recs) {
      const sku = (p.code || '').trim()
      if (sku) bySku.set(sku, {
        case_length_in: measurement(p.length), case_width_in: measurement(p.width),
        case_height_in: measurement(p.height), case_weight_lb: measurement(p.netWeight),
      })
    }
    if (recs.length === 0 || bySku.size >= (d.status?.recordsTotal ?? 0)) break
  }
  return bySku
}

async function fetchWoo() {
  const bySku = new Map()
  for (let pageNo = 1; ; pageNo++) {
    const res = await fetch(`${WOO_STORE_URL}/wp-json/wc/v3/products?per_page=100&page=${pageNo}&status=any`, {
      headers: { Authorization: `Basic ${Buffer.from(`${WOO_CONSUMER_KEY}:${WOO_CONSUMER_SECRET}`).toString('base64')}` },
    })
    if (!res.ok) throw new Error(`WooCommerce HTTP ${res.status} on page ${pageNo}`)
    const batch = await res.json()
    for (const p of batch) {
      const sku = (p.sku ?? '').trim()
      if (sku) bySku.set(sku, {
        case_length_in: measurement(p.dimensions?.length), case_width_in: measurement(p.dimensions?.width),
        case_height_in: measurement(p.dimensions?.height), case_weight_lb: measurement(p.weight),
      })
    }
    if (batch.length < 100) break
  }
  return bySku
}

// ── catalog ─────────────────────────────────────────────────────────────────

async function migrationApplied() {
  const { error } = await supabase.from('products').select('case_weight_lb').limit(1)
  if (!error) return true
  if (/case_weight_lb|column/.test(error.message)) return false
  throw new Error(error.message)
}

// `categories!products_category_id_fkey` and not the bare `categories`
// shorthand: the product_categories join table added a second relationship
// path, and the ambiguous form fails with PGRST201 (see CLAUDE.md and
// docs/memory/project-product-categories-outage-20260821.md).
const BASE_COLUMNS = 'id, sku, name, stock_qty, manually_hidden, category:categories!products_category_id_fkey(name)'
const MEASUREMENT_COLUMNS = 'case_length_in, case_width_in, case_height_in, case_weight_lb, measurements_source'

async function fetchCatalog(withMeasurements) {
  const columns = withMeasurements ? `${BASE_COLUMNS}, ${MEASUREMENT_COLUMNS}` : BASE_COLUMNS
  const all = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('products').select(columns)
      .eq('is_active', true).order('sku').range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    all.push(...data)
    if (data.length < pageSize) break
  }
  return all
}

async function main() {
  const applied = await migrationApplied()
  console.log(applied
    ? 'Migration 0045 applied -- reading measurements from Supabase.'
    : 'Migration 0045 not applied yet -- reading measurements from Erply/Woo instead.')

  const [catalog, erply, woo] = await Promise.all([
    fetchCatalog(applied),
    applied ? Promise.resolve(new Map()) : fetchErply(),
    applied ? Promise.resolve(new Map()) : fetchWoo(),
  ])
  console.log(`${catalog.length} active products.`)

  const CASE_FIELDS = ['case_length_in', 'case_width_in', 'case_height_in', 'case_weight_lb']

  const rows = catalog.map((p) => {
    const upstream = erply.get(p.sku) ?? woo.get(p.sku) ?? {}
    const caseVals = {}
    for (const f of CASE_FIELDS) caseVals[f] = measurement(applied ? p[f] : upstream[f])
    const badReason = implausible(caseVals)
    return {
      p,
      caseVals,
      badReason,
      // An implausible carton counts as not measured -- it needs a tape
      // measure just as much as a blank row does.
      hasCase: badReason == null && CASE_FIELDS.every((f) => caseVals[f] != null),
    }
  })

  // Blank columns are what the warehouse writes into; existing values are
  // pre-filled so nobody re-measures a carton that's already known.
  const sheetRow = (r) => ({
    SKU: r.p.sku,
    Name: r.p.name ?? '',
    Category: r.p.category?.name ?? '',
    'Pack spec': packSpec(r.p.name),
    'Units/case': unitsPerCase(r.p.name),
    'In stock': r.p.stock_qty ?? 0,
    'Case L (in)': r.caseVals.case_length_in ?? '',
    'Case W (in)': r.caseVals.case_width_in ?? '',
    'Case H (in)': r.caseVals.case_height_in ?? '',
    'Case Wt (lb)': r.caseVals.case_weight_lb ?? '',
    Notes: '',
  })

  // Highest stock first inside each sheet: a bin-capacity plan is only urgent
  // for products actually occupying the warehouse right now.
  const byStock = (a, b) => (b.p.stock_qty ?? 0) - (a.p.stock_qty ?? 0)

  // Implausible rows come out first so they aren't buried in the 1,000-row
  // "need case" sheets -- they look measured, which is what makes them
  // dangerous.
  const bad = rows.filter((r) => r.badReason != null).sort(byStock)
  const needCase = rows.filter((r) => !r.hasCase && r.badReason == null)
  const visibleNeedCase = needCase.filter((r) => r.p.manually_hidden === false).sort(byStock)
  const hiddenNeedCase = needCase.filter((r) => r.p.manually_hidden !== false).sort(byStock)

  const wb = XLSX.utils.book_new()
  const widths = [
    { wch: 14 }, { wch: 52 }, { wch: 20 }, { wch: 22 }, { wch: 11 }, { wch: 9 },
    { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 12 },
    { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 12 }, { wch: 30 },
  ]
  // The bad sheet carries a Reason column the others don't, so it's built
  // with the reason folded into Notes -- keeping one row shape for all sheets
  // means one importer can read any of them back.
  const badSheet = XLSX.utils.json_to_sheet(bad.map((r) => ({ ...sheetRow(r), Notes: `RECHECK: ${r.badReason}` })))
  badSheet['!cols'] = widths
  XLSX.utils.book_append_sheet(wb, badSheet, 'Implausible - Recheck')

  for (const [name, group] of [
    ['Visible - Need Case', visibleNeedCase],
    ['Hidden - Need Case', hiddenNeedCase],
  ]) {
    const sheet = XLSX.utils.json_to_sheet(group.map(sheetRow))
    sheet['!cols'] = widths
    XLSX.utils.book_append_sheet(wb, sheet, name)
  }

  const summary = [
    { Metric: 'Active products', Count: catalog.length },
    { Metric: 'Have full case measurements', Count: rows.filter((r) => r.hasCase).length },
    { Metric: 'Implausible - need recheck', Count: bad.length },
    { Metric: 'Need case measurements (visible)', Count: visibleNeedCase.length },
    { Metric: 'Need case measurements (hidden)', Count: hiddenNeedCase.length },
    { Metric: '', Count: '' },
    { Metric: 'ALL MEASUREMENTS ARE INCHES AND POUNDS', Count: '' },
    { Metric: `Generated ${new Date().toISOString().slice(0, 10)}`, Count: '' },
  ]
  const summarySheet = XLSX.utils.json_to_sheet(summary)
  summarySheet['!cols'] = [{ wch: 42 }, { wch: 10 }]
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Summary')

  console.table(summary.filter((s) => s.Count !== ''))

  const outDir = path.join(ROOT, 'data')
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, 'measurement-worklist.xlsx')
  XLSX.writeFile(wb, outPath)
  console.log(`\nWrote -> ${outPath}`)
}

await main()
