// audit-stock-vs-erply.ts
// Run with: node scripts/audit-stock-vs-erply.ts [--csv]
//
// REPORT ONLY. Writes nothing to Supabase, Erply or WooCommerce.
//
// Compares every catalog stock figure against Erply's, warehouse 1. Two
// questions it exists to answer:
//
//  1. Is the fake connectivity-test value still in ERPLY, or only in the
//     catalog? 1,879 catalog rows read exactly 1000 (see
//     docs/memory/project-fake-stock-1000-hold.md). Erply is the source of
//     truth and receiving ADDS to whatever is there -- if Erply also reads
//     1000, a container applied on top compounds the error; if Erply has real
//     figures, only the catalog is stale and the next stock sync fixes it.
//
//  2. How far apart are the two systems generally? products.stock_qty is
//     deliberately excluded from the normal product sync and maintained by
//     syncStockFromErply()'s anchored delta (migration 0042), so drift is
//     possible by design and worth measuring rather than assuming.

import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })

const WRITE_CSV = process.argv.includes('--csv')
const WAREHOUSE_ID = 1

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

interface CatalogRow {
  sku: string
  name: string | null
  stock_qty: number | null
  is_active: boolean
  manually_hidden: boolean | null
}

const catalog: CatalogRow[] = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from('products')
    .select('sku, name, stock_qty, is_active, manually_hidden')
    .range(from, from + 999)
  if (error) throw error
  catalog.push(...(data as CatalogRow[]))
  if (data.length < 1000) break
}
console.log(`catalog products: ${catalog.length}`)

// Erply stock, warehouse 1. getStockInfo=1 caps each page at 200 regardless of
// recordsOnPage, so the loop is driven by what came back.
const CC = process.env.ERPLY_CLIENT_CODE
if (!CC) {
  console.error('ERPLY_CLIENT_CODE is not set — nothing to compare against.')
  process.exit(1)
}
const post = async (params: Record<string, string>) =>
  (await (await fetch(`https://${CC}.erply.com/api/`, { method: 'POST', body: new URLSearchParams({ clientCode: CC, ...params }) })).json())

const auth = await post({
  request: 'verifyUser',
  username: process.env.ERPLY_USERNAME!,
  password: process.env.ERPLY_PASSWORD!,
})
const sessionKey = auth.records[0].sessionKey

const erplyStock = new Map<string, number>()
let total = Infinity
let seen = 0
for (let page = 1; seen < total; page++) {
  const data = await post({
    request: 'getProducts',
    sessionKey,
    recordsOnPage: '300',
    pageNo: String(page),
    getStockInfo: '1',
    active: '1',
  })
  total = data.status?.recordsTotal ?? 0
  const recs = data.records ?? []
  if (recs.length === 0) break
  seen += recs.length
  for (const r of recs) {
    const code = String(r.code ?? '').trim().toUpperCase()
    if (!code) continue
    // Erply returns stock as a STRING ("1000.000000"). Coerce it, or every
    // equality check against a number silently fails — the first run of this
    // script reported "Erply reads something else" for all 1,879 rows while
    // printing "erply 1000.000000" next to it.
    const raw = r.warehouses?.[String(WAREHOUSE_ID)]?.totalInStock
    erplyStock.set(code, raw == null ? 0 : Number(raw))
  }
}
console.log(`erply products with stock (warehouse ${WAREHOUSE_ID}): ${erplyStock.size}\n`)

interface Row {
  sku: string
  name: string
  catalogQty: number | null
  erplyQty: number | null
  delta: number | null
  state: string
}

const rows: Row[] = catalog.map((p) => {
  const erplyQty = erplyStock.has(p.sku.toUpperCase()) ? erplyStock.get(p.sku.toUpperCase())! : null
  return {
    sku: p.sku,
    name: p.name ?? '',
    catalogQty: p.stock_qty,
    erplyQty,
    delta: erplyQty != null && p.stock_qty != null ? erplyQty - p.stock_qty : null,
    state: p.manually_hidden ? 'hidden' : p.is_active ? 'visible' : 'inactive',
  }
})

// ── The fake-stock question ───────────────────────────────────────────────

const catalogIs1000 = rows.filter((r) => r.catalogQty === 1000)
const bothAre1000 = catalogIs1000.filter((r) => r.erplyQty === 1000)
const erplyDiffers = catalogIs1000.filter((r) => r.erplyQty != null && r.erplyQty !== 1000)
const notInErply = catalogIs1000.filter((r) => r.erplyQty == null)

console.log(`=== the ${catalogIs1000.length} catalog rows reading exactly 1000 ===`)
console.log(`  Erply also reads 1000        : ${bothAre1000.length}   <- the fake value is IN ERPLY`)
console.log(`  Erply reads something else   : ${erplyDiffers.length}   <- only the catalog is stale`)
console.log(`  SKU absent from Erply        : ${notInErply.length}`)

if (erplyDiffers.length > 0) {
  const sample = erplyDiffers.slice(0, 10)
  console.log('\n  examples where Erply has moved on:')
  for (const r of sample) console.log(`    ${r.sku.padEnd(14)} catalog 1000 -> erply ${r.erplyQty}   ${r.name.slice(0, 45)}`)
}

// Is 1000 a suspiciously common value in Erply itself?
const erplyAt1000 = [...erplyStock.values()].filter((v) => v === 1000).length
console.log(`\n  Erply SKUs reading exactly 1000 (any catalog value): ${erplyAt1000} of ${erplyStock.size}`)

// ── General divergence ────────────────────────────────────────────────────

const comparable = rows.filter((r) => r.delta != null)
const agree = comparable.filter((r) => r.delta === 0)
const differ = comparable.filter((r) => r.delta !== 0)
console.log(`\n=== all ${comparable.length} SKUs present in both systems ===`)
console.log(`  identical stock : ${agree.length}`)
console.log(`  different       : ${differ.length}`)
if (differ.length > 0) {
  const abs = differ.map((r) => Math.abs(r.delta!)).sort((a, b) => a - b)
  console.log(`  median gap ${abs[Math.floor(abs.length / 2)]}, largest ${abs[abs.length - 1]}`)
  console.log('\n  largest gaps:')
  for (const r of [...differ].sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!)).slice(0, 8)) {
    console.log(`    ${r.sku.padEnd(14)} catalog ${String(r.catalogQty).padStart(6)} -> erply ${String(r.erplyQty).padStart(6)}  (${r.delta! > 0 ? '+' : ''}${r.delta})  ${r.state}`)
  }
}

console.log(`\n  catalog rows with no Erply record at all: ${rows.filter((r) => r.erplyQty == null).length}`)

if (WRITE_CSV) {
  const esc = (v: unknown) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const out = [
    'sku,name,catalog_qty,erply_qty,delta,catalog_state',
    ...rows.map((r) => [r.sku, esc(r.name), r.catalogQty ?? '', r.erplyQty ?? '', r.delta ?? '', r.state].join(',')),
  ]
  const dest = path.join(ROOT, 'data', 'stock-vs-erply.csv')
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, out.join('\n') + '\n')
  console.log(`\nFull comparison written to ${dest}`)
}

console.log('\nNothing was changed.')
