// import-category-worklist.mjs
// Run with: node scripts/import-category-worklist.mjs                          (dry run)
//           node scripts/import-category-worklist.mjs --apply
//           node scripts/import-category-worklist.mjs --file=data/other.xlsx --apply
//
// Reads the reviewed "Category" column out of a worklist built by
// scripts/build-category-worklist.mjs (default: the newest
// data/category-worklist-*.xlsx) and sets each product's category: both
// products.category_id and a product_categories row, which the category
// pages read.
//
// Rows with a blank Category are skipped. A name that isn't an existing
// category (the Categories sheet) stops the whole run before anything is
// written -- a typo should never quietly create or drop a category.
//
// Only fills products whose category_id is still null, and the update is
// guarded on that, so a category set by hand or by the sync in the meantime
// is never overwritten. Writes data/category-worklist-backup-<date>.json
// first, then re-reads every product after applying.
//
// Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

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
const APPLY = process.argv.includes('--apply')

const fileArg = process.argv.find((a) => a.startsWith('--file='))
let FILE = fileArg ? path.resolve(ROOT, fileArg.slice(7)) : null
if (!FILE) {
  const latest = fs.readdirSync(path.join(ROOT, 'data'))
    .filter((f) => /^category-worklist-\d{4}-\d{2}-\d{2}\.xlsx$/.test(f))
    .sort()
    .pop()
  if (!latest) { console.error('No data/category-worklist-*.xlsx -- run build-category-worklist.mjs first'); process.exit(1) }
  FILE = path.join(ROOT, 'data', latest)
}
console.log(`Reading ${path.relative(ROOT, FILE)}`)

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

const sheet = XLSX.readFile(FILE).Sheets['Needs Category']
if (!sheet) { console.error('No "Needs Category" sheet in that file'); process.exit(1) }
const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
  .map((r) => ({ sku: String(r.SKU).trim(), category: String(r.Category).trim() }))
  .filter((r) => r.sku && r.category)

const { data: categories, error: ce } = await supabase.from('categories').select('id, name')
if (ce) throw new Error(`Supabase: ${ce.message}`)
const catByLower = new Map(categories.map((c) => [c.name.toLowerCase(), c]))

const unknown = [...new Set(rows.filter((r) => !catByLower.has(r.category.toLowerCase())).map((r) => r.category))]
if (unknown.length) {
  console.error(`Not an existing category (fix the sheet, nothing was written): ${unknown.map((u) => `"${u}"`).join(', ')}`)
  process.exit(1)
}

const { data: products, error: pe } = await supabase
  .from('products')
  .select('id, sku, name, category_id')
  .in('sku', rows.map((r) => r.sku))
if (pe) throw new Error(`Supabase: ${pe.message}`)
const bySku = new Map(products.map((p) => [p.sku.trim(), p]))

const plan = []
const skipped = []
for (const r of rows) {
  const p = bySku.get(r.sku)
  if (!p) { skipped.push(`${r.sku}: not in the catalog`); continue }
  if (p.category_id) { skipped.push(`${r.sku}: already has a category`); continue }
  plan.push({ id: p.id, sku: p.sku, name: p.name, category: catByLower.get(r.category.toLowerCase()) })
}

const tally = {}
for (const p of plan) tally[p.category.name] = (tally[p.category.name] ?? 0) + 1
console.log(`\n${plan.length} product(s) to categorize:`)
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`)
if (skipped.length) console.log(`\nSkipped ${skipped.length}:\n  ${skipped.join('\n  ')}`)

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write.')
  process.exit(0)
}

const stamp = new Date().toISOString().slice(0, 10)
const backup = path.join(ROOT, 'data', `category-worklist-backup-${stamp}.json`)
fs.writeFileSync(backup, JSON.stringify(plan.map((p) => ({ id: p.id, sku: p.sku, category_id_before: null, category_id_after: p.category.id })), null, 2))
console.log(`\nBackup: ${path.relative(ROOT, backup)}`)

let done = 0
let failed = 0
for (const p of plan) {
  const { data, error } = await supabase
    .from('products')
    .update({ category_id: p.category.id })
    .eq('id', p.id)
    .is('category_id', null)
    .select('id')
  if (error || !data.length) {
    failed++
    console.log(`  FAIL ${p.sku}: ${error?.message ?? 'category was set meanwhile, left alone'}`)
    continue
  }
  const { error: le } = await supabase
    .from('product_categories')
    .upsert({ product_id: p.id, category_id: p.category.id }, { onConflict: 'product_id,category_id', ignoreDuplicates: true })
  if (le) { failed++; console.log(`  FAIL ${p.sku} (join row): ${le.message}`); continue }
  done++
}

const { data: after } = await supabase.from('products').select('sku, category_id').in('id', plan.map((p) => p.id))
const wrong = after.filter((a) => a.category_id !== plan.find((p) => p.sku === a.sku)?.category.id)
console.log(`\nCategorized ${done}, failed ${failed}. Re-read: ${after.length - wrong.length}/${after.length} match the sheet.`)
