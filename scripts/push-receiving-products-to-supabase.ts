// push-receiving-products-to-supabase.ts
// Run with: node scripts/push-receiving-products-to-supabase.ts            (dry run)
//           node scripts/push-receiving-products-to-supabase.ts --apply
//
// Inserts the products that /admin/receiving created in ERPLY into the
// catalog's own products table. Receiving deliberately stops at Erply
// (app/admin/api/shipments/new-products/route.ts writes nothing to Supabase),
// and the Erply -> Supabase sync is what normally picks them up -- but that
// path is currently blocked: products.id's default draws from
// products_id_seq, whose value has fallen inside the band of hand-assigned
// prod-NNNNN ids created 2026-09-01, so every insert chunk dies with
// "duplicate key value violates unique constraint products_pkey" (observed
// 2026-09-23: 652 rows in two chunks, taking their updates down with them).
// supabase/migrations/0052 reseeds the sequence; this script assigns ids
// explicitly so it does not depend on that having been applied.
//
// Every product it creates is HIDDEN (manually_hidden = true) because it is
// priced at 0: Erply cannot accept a price over the API on this account
// (proven 2026-09-16), so a received product has no price until someone sets
// one in Erply by hand, and lib/order-submission.ts checks only
// is_active/manually_hidden -- a visible $0.00 product can go on a real
// order. Unhide with scripts/zero-price-visibility.mjs --unhide once a real
// sync has brought the price across.
//
// Refuses to touch any SKU that already has a price in Erply: that one
// belongs to the normal sync, which owns the pricing formula (lib/erply.ts's
// roundToQuarterSkip75 x RETAIL_MULTIPLIER). This script deliberately
// contains no pricing logic to duplicate.
//
// Dry run by default. --apply writes a CSV of every row it created to data/
// and re-reads them afterwards.
//
// Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//                         ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
import { resolveErplyCategoryAlias } from '../lib/erply-category-aliases.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const APPLY = process.argv.includes('--apply')
const WAREHOUSE_ID = 1

const CC = process.env.ERPLY_CLIENT_CODE
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
for (const [name, val] of Object.entries({
  ERPLY_CLIENT_CODE: CC,
  ERPLY_USERNAME: process.env.ERPLY_USERNAME,
  ERPLY_PASSWORD: process.env.ERPLY_PASSWORD,
  NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
})) {
  if (!val) { console.error(`Missing in .env.local: ${name}`); process.exit(1) }
}

const db = createClient(SUPABASE_URL!, SERVICE_KEY!)

async function erplyPost(params: Record<string, string>) {
  const res = await fetch(`https://${CC}.erply.com/api/`, {
    method: 'POST',
    body: new URLSearchParams({ clientCode: CC!, ...params }),
  })
  if (!res.ok) throw new Error(`Erply HTTP ${res.status}`)
  const json = await res.json()
  if (json.status?.responseStatus === 'error') {
    throw new Error(`Erply error ${json.status.errorCode}: ${json.status.errorField ?? 'unknown'}`)
  }
  return json
}

async function selectAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select(columns).range(from, from + 999)
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...((data ?? []) as T[]))
    if ((data ?? []).length < 1000) break
  }
  return out
}

// 1. Which SKUs did receiving create in Erply?
const lines = await selectAll<{ sku: string; erply_created_product_id: number | null }>(
  'shipment_lines', 'sku, erply_created_product_id',
)
const createdSkus = [...new Set(
  lines.filter((l) => l.erply_created_product_id).map((l) => l.sku.trim().toUpperCase()),
)]
console.log(`receiving created ${createdSkus.length} SKU(s) in Erply`)

// 2. What does the catalog already have?
const products = await selectAll<{ id: string; sku: string }>('products', 'id, sku')
const haveSku = new Set(products.map((p) => p.sku.trim().toUpperCase()))
const missing = createdSkus.filter((s) => !haveSku.has(s))
console.log(`${missing.length} of them are not in the catalog yet`)
if (missing.length === 0) process.exit(0)

// 3. Read each one back from Erply -- the authority on name, group, barcode,
//    price and stock. The staged line is not trusted for any of these.
const auth = await erplyPost({
  request: 'verifyUser',
  username: process.env.ERPLY_USERNAME!,
  password: process.env.ERPLY_PASSWORD!,
})
const sessionKey = auth.records[0].sessionKey

interface ErplyRow {
  code: string
  name: string
  code2?: string
  price?: number
  groupName?: string
  active?: number
  warehouses?: Record<string, { totalInStock?: number }>
}
const erplyBySku = new Map<string, ErplyRow>()
for (const sku of missing) {
  const d = await erplyPost({ request: 'getProducts', sessionKey, code: sku, getStockInfo: '1' })
  const hit = (d.records ?? []).find((r: ErplyRow) => r.code?.trim().toUpperCase() === sku)
  if (hit) erplyBySku.set(sku, hit)
}
console.log(`${erplyBySku.size} found in Erply`)

// 4. Category names -> ids, through the same alias map the sync uses.
const { data: catRows } = await db.from('categories').select('id, name')
const catIdByName = new Map((catRows ?? []).map((c) => [c.name.toLowerCase(), c.id]))

// 5. Build the rows. ids continue the prod-NNNNN convention from the current
//    maximum -- see the header for why they are assigned here and not left to
//    the column default.
let nextId = products.reduce((max, p) => {
  const m = /^prod-(\d+)$/.exec(p.id)
  return m ? Math.max(max, parseInt(m[1], 10)) : max
}, 0) + 1

const rows: Record<string, unknown>[] = []
const skippedPriced: string[] = []
const skippedNoErply: string[] = []
const noCategory: string[] = []

for (const sku of missing) {
  const e = erplyBySku.get(sku)
  if (!e) { skippedNoErply.push(sku); continue }
  if ((e.price ?? 0) > 0) { skippedPriced.push(sku); continue }

  const categoryName = resolveErplyCategoryAlias(e.groupName ?? '')
  const categoryId = catIdByName.get(categoryName.toLowerCase()) ?? null
  if (!categoryId) noCategory.push(`${sku} (${e.groupName ?? 'no group'} -> ${categoryName})`)

  rows.push({
    id: `prod-${String(nextId++).padStart(5, '0')}`,
    sku: e.code.trim(),
    barcode: e.code2?.trim() || null,
    name: e.name,
    description: null,
    price_cents: 0,
    stock_qty: Number(e.warehouses?.[String(WAREHOUSE_ID)]?.totalInStock ?? 0),
    is_active: e.active === 1,
    manually_hidden: true,   // priced at 0 -- see header
    needs_photo: true,       // scripts/upload-container-photos.mjs clears this
    category_id: categoryId,
    image_url: null,
    image_urls: [],
  })
}

console.log(`\n${rows.length} product(s) to insert${APPLY ? '' : '  (dry run - nothing written)'}`)
for (const r of rows) {
  console.log(`  ${r.id}  ${String(r.sku).padEnd(20)} stock ${String(r.stock_qty).padStart(6)}  cat ${String(r.category_id ?? 'NONE').padEnd(8)} ${String(r.name).slice(0, 55)}`)
}
if (skippedPriced.length) console.log(`\nSkipped - already priced in Erply, the sync should insert these: ${skippedPriced.join(', ')}`)
if (skippedNoErply.length) console.log(`\nSkipped - not found in Erply: ${skippedNoErply.join(', ')}`)
if (noCategory.length) console.log(`\nNo category matched (would insert with category_id null):\n  ${noCategory.join('\n  ')}`)
if (!APPLY) { console.log('\nRe-run with --apply to write.'); process.exit(0) }

const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
const csvPath = path.join(ROOT, 'data', `receiving-products-pushed-${stamp}.csv`)
const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
fs.writeFileSync(
  csvPath,
  ['id,sku,barcode,name,stock_qty,category_id,manually_hidden']
    .concat(rows.map((r) => [r.id, r.sku, r.barcode, esc(r.name), r.stock_qty, r.category_id, r.manually_hidden].join(',')))
    .join('\n') + '\n',
)
console.log(`\nBackup written: ${path.relative(ROOT, csvPath)}`)

const CHUNK = 100
let inserted = 0
for (let i = 0; i < rows.length; i += CHUNK) {
  const chunk = rows.slice(i, i + CHUNK)
  const { error } = await db.from('products').insert(chunk)
  if (error) console.error(`  chunk ${i / CHUNK}: ${error.message}`)
  else inserted += chunk.length
}
console.log(`Inserted ${inserted}/${rows.length}.`)

const { data: after } = await db
  .from('products')
  .select('sku, price_cents, stock_qty, manually_hidden, category_id')
  .in('sku', rows.map((r) => r.sku as string))
console.log(`Read back ${after?.length ?? 0} rows - hidden: ${(after ?? []).filter((p) => p.manually_hidden).length}, with stock: ${(after ?? []).filter((p) => (p.stock_qty ?? 0) > 0).length}, with category: ${(after ?? []).filter((p) => p.category_id).length}`)
