// audit-suffix-barcode-collisions.ts
// Run with: node scripts/audit-suffix-barcode-collisions.ts [--csv] [--xlsx]
//
// REPORT ONLY. Writes nothing anywhere.
//
// Lists every case where a suffixed SKU (F284020-LP, T641546-1) shares a
// barcode with its own base SKU (F284020, T641546). 38 of the catalog's 106
// duplicate-barcode groups have this shape.
//
// Why this shape specifically: the two SKUs are usually genuinely DIFFERENT
// products -- "Solid Purple Flower Lei" vs "Solid Light Purple Flower Leis",
// "Clear Strawberry Print Fan" vs "Clear Watermelon Print Fan" -- so it is not
// a duplicate listing to merge away. One of the pair simply carries the
// other's barcode. That makes it a data defect with a real consequence: a
// barcode scan cannot distinguish them, and the variant is usually the one
// missing from Erply.
//
// Sharpens the "~103 barcode families still need review" item in
// docs/memory/project-duplicate-barcode-families.md into something reviewable
// one row at a time.

import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const XLSX: any = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })

const WRITE_CSV = process.argv.includes('--csv')
const WRITE_XLSX = process.argv.includes('--xlsx')

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { autoRefreshToken: false, persistSession: false },
})

interface Product {
  sku: string
  name: string | null
  barcode: string | null
  is_active: boolean
  manually_hidden: boolean | null
  stock_qty: number | null
}

const products: Product[] = []
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from('products')
    .select('sku, name, barcode, is_active, manually_hidden, stock_qty')
    .range(from, from + 999)
  if (error) throw error
  products.push(...(data as Product[]))
  if (data.length < 1000) break
}

// Which SKUs exist in Erply? One paged walk rather than a call per SKU.
const CC = process.env.ERPLY_CLIENT_CODE
const inErply = new Set<string>()
if (CC) {
  const post = async (params: Record<string, string>) =>
    (await (await fetch(`https://${CC}.erply.com/api/`, { method: 'POST', body: new URLSearchParams({ clientCode: CC, ...params }) })).json())
  const auth = await post({
    request: 'verifyUser',
    username: process.env.ERPLY_USERNAME!,
    password: process.env.ERPLY_PASSWORD!,
  })
  const sessionKey = auth.records?.[0]?.sessionKey
  if (sessionKey) {
    let total = Infinity
    for (let page = 1; inErply.size < total; page++) {
      const data = await post({ request: 'getProducts', sessionKey, recordsOnPage: '300', pageNo: String(page) })
      total = data.status?.recordsTotal ?? 0
      const recs = data.records ?? []
      if (recs.length === 0) break
      for (const r of recs) if (r.code) inErply.add(String(r.code).trim().toUpperCase())
    }
  }
}
console.log(`Erply products indexed: ${inErply.size}\n`)

// Order history, so "never sold" can be said with evidence rather than assumed.
const ordered = new Map<string, number>()
for (let from = 0; ; from += 1000) {
  const { data } = await db.from('order_items').select('sku, qty').range(from, from + 999)
  for (const row of data ?? []) ordered.set(row.sku, (ordered.get(row.sku) ?? 0) + (row.qty ?? 0))
  if (!data || data.length < 1000) break
}

// Leading zeros are a documented gap in this project's barcodes, so compare
// digits with them stripped.
const norm = (b: string | null) => String(b ?? '').trim().replace(/^0+/, '')

const byBarcode = new Map<string, Product[]>()
for (const p of products) {
  const key = norm(p.barcode)
  if (!key) continue
  if (!byBarcode.has(key)) byBarcode.set(key, [])
  byBarcode.get(key)!.push(p)
}

interface Row {
  barcode: string
  variantSku: string
  variantName: string
  variantState: string
  variantInErply: string
  variantStock: number | null
  baseSku: string
  baseName: string
  baseInErply: string
  verdict: string
  everOrdered: string
}

// Drop the pack spec before comparing names: two rows differing only in
// "- 12/pk 25bx/cs cs.25pk" are the same product description.
const stripSpec = (n: string | null) => (n ?? '').replace(/\s*-\s*\d+\/pk.*$/i, '').trim().toLowerCase()

const rows: Row[] = []
for (const [barcode, group] of byBarcode) {
  if (group.length < 2) continue
  const bases = group.filter((p) => !p.sku.includes('-'))
  const variants = group.filter((p) => p.sku.includes('-'))
  if (bases.length === 0 || variants.length === 0) continue

  for (const variant of variants) {
    // Only when the variant's prefix IS one of the bases sharing this barcode.
    const base = bases.find((b) => variant.sku.toUpperCase().startsWith(b.sku.toUpperCase() + '-'))
    if (!base) continue
    const totalOrdered = (ordered.get(base.sku) ?? 0) + (ordered.get(variant.sku) ?? 0)
    rows.push({
      barcode,
      variantSku: variant.sku,
      variantName: variant.name ?? '',
      variantState: variant.manually_hidden ? 'hidden' : variant.is_active ? 'VISIBLE' : 'inactive',
      variantInErply: inErply.has(variant.sku.toUpperCase()) ? 'yes' : 'NO',
      variantStock: variant.stock_qty,
      baseSku: base.sku,
      baseName: base.name ?? '',
      baseInErply: inErply.has(base.sku.toUpperCase()) ? 'yes' : 'NO',
      verdict:
        stripSpec(base.name) === stripSpec(variant.name)
          ? 'same description — likely a duplicate listing'
          : 'different product — one carries the wrong barcode',
      everOrdered: totalOrdered > 0 ? `base ${ordered.get(base.sku) ?? 0}, variant ${ordered.get(variant.sku) ?? 0}` : 'never',
    })
  }
}

rows.sort((a, b) => a.variantSku.localeCompare(b.variantSku))

console.log(`${rows.length} suffixed SKUs share a barcode with their own base SKU.\n`)
console.log(`  variant VISIBLE in the catalog : ${rows.filter((r) => r.variantState === 'VISIBLE').length}   <- a scan cannot tell these apart`)
console.log(`  variant missing from Erply     : ${rows.filter((r) => r.variantInErply === 'NO').length}`)
console.log(`  same description as its base   : ${rows.filter((r) => r.verdict.startsWith('same')).length}   <- likely duplicate listings`)
console.log(`  ever ordered (base or variant) : ${rows.filter((r) => r.everOrdered !== 'never').length}\n`)

for (const r of rows) {
  console.log(`  ${r.variantSku.padEnd(16)} ${r.variantState.padEnd(8)} erply:${r.variantInErply.padEnd(4)} ${r.verdict}`)
  console.log(`      ${r.variantName}`)
  console.log(`      base ${r.baseSku} (erply:${r.baseInErply}) — ${r.baseName}`)
  console.log(`      barcode ${r.barcode} · ordered: ${r.everOrdered}`)
}

const sheet = rows.map((r) => ({
  Barcode: r.barcode,
  'Variant SKU': r.variantSku,
  'Variant name': r.variantName,
  'Variant in catalog': r.variantState,
  'Variant in Erply': r.variantInErply,
  'Variant stock': r.variantStock ?? '',
  'Base SKU': r.baseSku,
  'Base name': r.baseName,
  'Base in Erply': r.baseInErply,
  Verdict: r.verdict,
  'Ever ordered': r.everOrdered,
}))

if (WRITE_XLSX && sheet.length > 0) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), 'Suffix barcode collisions')
  const dest = path.join(ROOT, 'data', 'suffix-barcode-collisions.xlsx')
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  XLSX.writeFile(wb, dest)
  console.log(`\nWorkbook written to ${dest}`)
}

if (WRITE_CSV && sheet.length > 0) {
  const esc = (v: unknown) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = Object.keys(sheet[0])
  const out = [header.join(','), ...sheet.map((r) => header.map((h) => esc((r as Record<string, unknown>)[h])).join(','))]
  const dest = path.join(ROOT, 'data', 'suffix-barcode-collisions.csv')
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, out.join('\n') + '\n')
  console.log(`\nFull list written to ${dest}`)
}

console.log('\nNothing was changed.')
