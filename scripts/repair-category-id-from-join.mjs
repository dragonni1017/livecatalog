// repair-category-id-from-join.mjs
// Run with: node scripts/repair-category-id-from-join.mjs           (dry run)
//           node scripts/repair-category-id-from-join.mjs --apply
//
// Restores products.category_id for products whose category_id is NULL but
// which have exactly one product_categories row. Found 2026-10-01: 666 such
// products. The cause was syncToSupabase upserting new and existing rows in
// one batch. supabase-js sends the union of all rows' keys, so an existing row
// without category_id had it written as NULL whenever its 500-row chunk held a
// new product. Fixed in lib/product-sync.ts the same day.
//
// Products with 2+ join rows are reported and never touched, because there's
// no way to tell which was primary. Each update is guarded by
// `category_id is null`, so a value set by hand meanwhile is never
// overwritten. Writes data/category-id-repair-backup-<date>.json first, then
// re-reads every product after applying.
//
// Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })

const APPLY = process.argv.includes('--apply')
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function fetchAll(table, columns, orderBy) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).order(orderBy).range(from, from + 999)
    if (error) throw error
    out.push(...data)
    if (data.length < 1000) return out
  }
}

const products = await fetchAll('products', 'id, sku, category_id', 'id')
const joins = await fetchAll('product_categories', 'product_id, category_id', 'product_id')
const joinsByProduct = new Map()
for (const j of joins) joinsByProduct.set(j.product_id, [...(joinsByProduct.get(j.product_id) ?? []), j.category_id])

const repairs = []
const ambiguous = []
for (const p of products) {
  if (p.category_id) continue
  const cats = joinsByProduct.get(p.id)
  if (!cats) continue
  if (cats.length === 1) repairs.push({ id: p.id, sku: p.sku, category_id: cats[0] })
  else ambiguous.push({ id: p.id, sku: p.sku, category_ids: cats })
}

console.log(`${products.length} products; ${repairs.length} to repair; ${ambiguous.length} ambiguous (skipped)`)
for (const a of ambiguous) console.log(`  ambiguous: ${a.sku} -> ${a.category_ids.join(', ')}`)

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to write.')
  process.exit(0)
}

const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
const backup = path.join(ROOT, 'data', `category-id-repair-backup-${stamp}.json`)
fs.writeFileSync(backup, JSON.stringify({ repairs, ambiguous }, null, 2))
console.log(`backup written: ${path.relative(ROOT, backup)}`)

// One guarded update per category rather than 666 round trips.
const byCategory = new Map()
for (const r of repairs) byCategory.set(r.category_id, [...(byCategory.get(r.category_id) ?? []), r.id])
let updated = 0
for (const [categoryId, ids] of byCategory) {
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200)
    const { data, error } = await db
      .from('products')
      .update({ category_id: categoryId })
      .in('id', chunk)
      .is('category_id', null)
      .select('id')
    if (error) throw error
    updated += data.length
  }
}
console.log(`updated: ${updated}`)

// Independent re-read.
const after = await fetchAll('products', 'id, category_id', 'id')
const afterById = new Map(after.map((p) => [p.id, p.category_id]))
const wrong = repairs.filter((r) => afterById.get(r.id) !== r.category_id)
console.log(`verified: ${repairs.length - wrong.length}/${repairs.length} now hold their join-row category`)
for (const w of wrong.slice(0, 20)) console.log(`  MISMATCH ${w.sku}: expected ${w.category_id}, has ${afterById.get(w.id)}`)
