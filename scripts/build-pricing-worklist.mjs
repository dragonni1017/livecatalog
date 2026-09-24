// build-pricing-worklist.mjs
// Run with: node scripts/build-pricing-worklist.mjs
//
// REPORT ONLY. Writes one xlsx and touches nothing else.
//
// Every catalog product sitting at price 0, with whatever this system knows
// that helps decide a price. It exists because pricing is a manual pass in
// Erply -- saveProduct cannot set a price on this account (proven
// 2026-09-16, six parameter combinations, all returned ok and left the price
// at 0), and that is a closed decision, not an open problem.
//
// The suggestion column is a STARTING POINT, not an answer. It comes from
// products already priced in this catalog, in two tiers:
//
//   family   -- SKUs sharing the part before the first "-" (P273814-45cm and
//               P273814-60cm are the same product in two sizes). Strong.
//   category -- the median price of the product's category. Weak, and only
//               offered when there is no family comparable.
//
// Neither knows anything about what the goods cost, because no invoice unit
// price was captured for any of these lines. Pack size is printed next to
// every comparable for exactly that reason: "60pk/cs" priced like a single
// piece is the mistake this column could cause.
//
// Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const db = createClient(SUPABASE_URL, SERVICE_KEY)

const all = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from('products')
    .select('sku, name, price_cents, stock_qty, manually_hidden, is_active, category_id, category:categories!products_category_id_fkey(name)')
    .range(from, from + 999)
  if (error) { console.error(error.message); process.exit(1) }
  all.push(...(data ?? []))
  if ((data ?? []).length < 1000) break
}

// Which containers each SKU arrived on, so a pricing decision can be traced
// back to a shipment.
const { data: lines, error: lineErr } = await db
  .from('shipment_lines')
  .select('sku, qty_received, pieces_per_case, shipment_id, erply_created_product_id')
  .not('erply_created_product_id', 'is', null)
if (lineErr) { console.error(lineErr.message); process.exit(1) }
const { data: ships } = await db.from('shipments').select('id, container_ref')
const containerById = new Map((ships ?? []).map((s) => [s.id, s.container_ref]))
const meta = new Map()
for (const l of lines ?? []) {
  const key = l.sku.toUpperCase()
  const m = meta.get(key) ?? { containers: new Set(), qty: 0, ppc: l.pieces_per_case, erplyId: l.erply_created_product_id }
  m.containers.add(containerById.get(l.shipment_id) ?? '?')
  m.qty += l.qty_received ?? 0
  meta.set(key, m)
}

const priced = all.filter((p) => (p.price_cents ?? 0) > 0)
const unpriced = all.filter((p) => (p.price_cents ?? 0) === 0)
const money = (c) => `$${(c / 100).toFixed(2)}`
const median = (nums) => {
  const s = [...nums].sort((a, b) => a - b)
  return s.length === 0 ? null : s[Math.floor(s.length / 2)]
}

// Category medians, for the weak tier.
const byCategory = new Map()
for (const p of priced) {
  if (!p.category_id) continue
  byCategory.set(p.category_id, [...(byCategory.get(p.category_id) ?? []), p.price_cents])
}

const rows = unpriced.map((p) => {
  const base = p.sku.split(/[-_]/)[0]
  const family = priced
    .filter((q) => q.sku.split(/[-_]/)[0] === base)
    .sort((a, b) => a.sku.localeCompare(b.sku))
  const m = meta.get(p.sku.toUpperCase())

  let suggestion = null
  let basis = 'none — no comparable, price from scratch'
  let confidence = ''
  if (family.length > 0) {
    suggestion = median(family.map((f) => f.price_cents))
    confidence = 'family'
    basis = family.slice(0, 3).map((f) => `${f.sku} ${money(f.price_cents)}`).join(' | ')
  } else if (p.category_id && byCategory.has(p.category_id)) {
    const list = byCategory.get(p.category_id)
    suggestion = median(list)
    confidence = 'category (weak)'
    basis = `median of ${list.length} priced products in ${p.category?.name ?? 'this category'}`
  }

  return {
    SKU: p.sku,
    'Product name': p.name,
    Category: p.category?.name ?? '(none)',
    Container: m ? [...m.containers].join(', ') : '',
    'Pieces received': m?.qty ?? '',
    'Pieces per case': m?.ppc ?? '',
    'Erply product ID': m?.erplyId ?? '',
    'Suggested price': suggestion == null ? '' : Number((suggestion / 100).toFixed(2)),
    'Suggestion based on': confidence,
    'Comparables': basis,
    'PRICE (fill this in)': '',
    'Live on site': p.manually_hidden ? 'No — hidden until priced' : 'Yes',
  }
})

rows.sort((a, b) => String(a.Category).localeCompare(String(b.Category)) || String(a.SKU).localeCompare(String(b.SKU)))

const wb = XLSX.utils.book_new()
const ws = XLSX.utils.json_to_sheet(rows)
ws['!cols'] = [
  { wpx: 120 }, { wpx: 330 }, { wpx: 130 }, { wpx: 110 }, { wpx: 90 }, { wpx: 90 },
  { wpx: 90 }, { wpx: 95 }, { wpx: 115 }, { wpx: 320 }, { wpx: 130 }, { wpx: 150 },
]
ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { c: 0, r: 0 }, e: { c: 11, r: rows.length } }) }
XLSX.utils.book_append_sheet(wb, ws, `Unpriced (${rows.length})`)

const out = path.join(ROOT, 'data', `pricing-worklist-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`)
XLSX.writeFile(wb, out)

const fam = rows.filter((r) => r['Suggestion based on'] === 'family').length
const cat = rows.filter((r) => r['Suggestion based on'] === 'category (weak)').length
console.log(`${rows.length} unpriced product(s)`)
console.log(`  ${fam} with a family comparable, ${cat} with only a category median, ${rows.length - fam - cat} with neither`)
console.log(`\nWritten: ${path.relative(ROOT, out)}`)
console.log('\nPricing is a manual pass in Erply -- saveProduct cannot set a price on this account.')
console.log('After pricing, run the Erply sync, then:')
console.log('  node scripts/zero-price-visibility.mjs --unhide          (dry run)')
console.log('  node scripts/zero-price-visibility.mjs --unhide --apply')
