// build-price-outlier-list.mjs
// Run with: node scripts/build-price-outlier-list.mjs
//           node scripts/build-price-outlier-list.mjs --all      (hidden products too)
//
// Read-only. Lists catalog prices that look wrong, as a handoff sheet for
// whoever prices in Erply -- prices are entered there and the Erply sync owns
// price_cents, so nothing here writes a price.
//
// Three checks, each its own sheet. A product can appear on more than one.
//   Category  -- price at least 5x, or at most 1/5 of, the median price of
//                its category (categories with fewer than 8 priced products
//                are skipped: too few to have a meaningful median).
//   Same name -- two or more products with the same name, letter case and
//                spacing aside, at different prices (e.g. F287384/F287385).
//   Variants  -- SKUs sharing a base (F102518, F102518-RD, ...) where the
//                dearest is more than 2x the cheapest. Size variants
//                (-25CM, -45CM) are expected to differ and are left out.
//
// Default scope is what customers see (is_active and not manually_hidden);
// --all adds hidden products that have a price. $0 products are excluded:
// those are "not priced yet", already listed on /admin/cleanup's Needs
// pricing tab.
//
// Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Writes: data/price-outliers-<date>.xlsx (--all: price-outliers-all-<date>.xlsx).
// Writes nothing else.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
for (const [name, val] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_KEY })) {
  if (!val) { console.error(`Missing in .env.local: ${name}`); process.exit(1) }
}
const INCLUDE_HIDDEN = process.argv.includes('--all')
const stamp = new Date().toISOString().slice(0, 10)
const OUT = path.join(ROOT, 'data', `price-outliers-${INCLUDE_HIDDEN ? 'all-' : ''}${stamp}.xlsx`)

const CATEGORY_FACTOR = 5
const CATEGORY_MIN_SIZE = 8
const VARIANT_FACTOR = 2

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const { data: categories, error: ce } = await supabase.from('categories').select('id, name')
if (ce) throw new Error(`Supabase: ${ce.message}`)
const catName = new Map(categories.map((c) => [c.id, c.name]))

const all = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await supabase
    .from('products')
    .select('id, sku, name, price_cents, category_id, is_active, manually_hidden, stock_qty')
    .order('id')
    .range(from, from + 999)
  if (error) throw new Error(`Supabase: ${error.message}`)
  all.push(...data)
  if (data.length < 1000) break
}
const products = all.filter((p) => p.sku && p.is_active && p.price_cents > 0 && (INCLUDE_HIDDEN || !p.manually_hidden))
console.log(`${products.length} priced ${INCLUDE_HIDDEN ? 'active' : 'visible'} products`)

const dollars = (c) => Math.round(c) / 100
const row = (p, extra) => ({
  SKU: p.sku,
  Name: p.name,
  Price: dollars(p.price_cents),
  Category: catName.get(p.category_id) ?? '',
  Visible: p.manually_hidden ? 'no' : 'yes',
  Stock: p.stock_qty ?? '',
  ...extra,
})
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

// ── Category ────────────────────────────────────────────────────────────────
const byCat = new Map()
for (const p of products) {
  if (!p.category_id) continue
  ;(byCat.get(p.category_id) ?? byCat.set(p.category_id, []).get(p.category_id)).push(p)
}
// "20/pk 60bx/cs" -> 60. A high price that comes back to roughly the category
// median once divided by this was most likely typed as the whole case
// (F286938: $180 = 60 boxes x $3, in a category whose median is $3).
const boxesPerCase = (name) => Number(/(\d+)\s*bx\s*\/\s*cs/i.exec(name)?.[1]) || null

const categoryRows = []
for (const [, ps] of byCat) {
  if (ps.length < CATEGORY_MIN_SIZE) continue
  const med = median(ps.map((p) => p.price_cents))
  for (const p of ps) {
    const ratio = p.price_cents / med
    if (ratio >= CATEGORY_FACTOR || ratio <= 1 / CATEGORY_FACTOR) {
      const bx = boxesPerCase(p.name)
      const perBox = bx && bx > 1 ? p.price_cents / bx : null
      // Only for a big gap and a big case: dividing by a small box count lands
      // near the median by chance (a $33 hair dryer / 20 bx is not a $1.65 one).
      const casePrice = ratio >= 20 && bx >= 24 && perBox / med >= 0.5 && perBox / med <= 2
      categoryRows.push(row(p, {
        'Category median': dollars(med),
        'x median': Math.round(ratio * 100) / 100,
        'Likely case price': casePrice ? `yes: $${dollars(p.price_cents)} / ${bx} bx = $${dollars(perBox)}` : '',
        Why: ratio >= 1 ? `${Math.round(ratio)}x the category median` : `1/${Math.round(1 / ratio)} of the category median`,
      }))
    }
  }
}
categoryRows.sort((a, b) => Number(!!b['Likely case price']) - Number(!!a['Likely case price']) || b['x median'] - a['x median'])

// ── Same name ───────────────────────────────────────────────────────────────
const normName = (n) => n.toLowerCase().replace(/\s+/g, ' ').trim()
const byName = new Map()
for (const p of products) (byName.get(normName(p.name)) ?? byName.set(normName(p.name), []).get(normName(p.name))).push(p)
const nameRows = []
let group = 0
for (const [, ps] of byName) {
  if (ps.length < 2 || new Set(ps.map((p) => p.price_cents)).size < 2) continue
  group++
  const prices = ps.map((p) => dollars(p.price_cents))
  for (const p of ps.sort((a, b) => a.sku.localeCompare(b.sku))) {
    nameRows.push(row(p, { Group: group, Why: `same name, prices ${[...new Set(prices)].sort((a, b) => a - b).map((x) => `$${x}`).join(' / ')}` }))
  }
}

// ── Variants ────────────────────────────────────────────────────────────────
// Base = the SKU up to its first "-". A size suffix (-25CM, -10IN, -40OZ)
// is a different product at a different price by design.
const SIZE_SUFFIX = /-\d+(\.\d+)?\s*(cm|mm|in|inch|oz|ml|l|ft|yd|yard)s?\b/i
const byBase = new Map()
for (const p of products) {
  if (SIZE_SUFFIX.test(p.sku)) continue
  const base = p.sku.trim().toUpperCase().split('-')[0]
  ;(byBase.get(base) ?? byBase.set(base, []).get(base)).push(p)
}
const variantRows = []
for (const [base, ps] of byBase) {
  if (ps.length < 2) continue
  const lo = Math.min(...ps.map((p) => p.price_cents))
  const hi = Math.max(...ps.map((p) => p.price_cents))
  if (hi / lo <= VARIANT_FACTOR) continue
  for (const p of ps.sort((a, b) => a.sku.localeCompare(b.sku))) {
    variantRows.push(row(p, { Base: base, Why: `${base} variants range $${dollars(lo)} to $${dollars(hi)}` }))
  }
}

// ── Write ───────────────────────────────────────────────────────────────────
const sheet = (rows, widths) => {
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ SKU: '(none)' }])
  ws['!cols'] = widths.map((wch) => ({ wch }))
  if (rows.length) ws['!autofilter'] = { ref: ws['!ref'] }
  return ws
}
const base = [12, 50, 8, 22, 8, 8]
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, sheet(categoryRows, [...base, 10, 9, 30, 32]), 'Category')
XLSX.utils.book_append_sheet(wb, sheet(nameRows, [...base, 7, 40]), 'Same name')
XLSX.utils.book_append_sheet(wb, sheet(variantRows, [...base, 12, 40]), 'Variants')
fs.mkdirSync(path.dirname(OUT), { recursive: true })
XLSX.writeFile(wb, OUT)

console.log(`\nCategory outliers: ${categoryRows.length} (${categoryRows.filter((r) => r['Likely case price']).length} look like a whole-case price)`)
for (const r of categoryRows.slice(0, 15)) console.log(`  ${r.SKU.padEnd(14)} $${String(r.Price).padStart(6)}  ${r.Why.padEnd(32)} ${r.Category}: ${r.Name.slice(0, 40)}`)
console.log(`Same name, different price: ${group} group(s), ${nameRows.length} products`)
console.log(`Variants more than ${VARIANT_FACTOR}x apart: ${new Set(variantRows.map((r) => r.Base)).size} base SKU(s), ${variantRows.length} products`)
console.log(`\nWrote ${path.relative(ROOT, OUT)}`)
