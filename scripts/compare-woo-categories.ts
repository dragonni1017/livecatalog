// compare-woo-categories.ts
// Run with: node scripts/compare-woo-categories.ts
//
// REPORT ONLY. Reads the catalog and WooCommerce (GET requests only) and
// writes data/woo-category-compare-<date>.xlsx. Changes nothing anywhere.
//
// Do products sit in the same category on the catalog (lyusa.app) and on
// WooCommerce (ly-usa.com)? Nothing keeps them in step: categories are set
// separately on each side (see scripts/fix-category-drift.mjs). The catalog
// category is translated to its WooCommerce path with lib/woo-categories.ts,
// then compared with the categories the WooCommerce product is actually in,
// matched by SKU. Only visible catalog products are checked.
//
// Results per product:
//   match          the WooCommerce product is in the mapped category (it may be
//                  in others too; WooCommerce allows several)
//   subcategory    it's in a subcategory of the mapped one (Drinkware > Tumblers
//                  for Drinkware): fine, WooCommerce is just more specific
//   parent only    it's in the mapped category's parent but not the category
//   different      it's in categories, none of them the mapped one
//   uncategorized  it's only in WooCommerce's "Uncategorized"
//   guess mapping  the catalog category's WooCommerce path is marked a guess
//   no mapping     the catalog category isn't in lib/woo-categories.ts
//   not on Woo     no WooCommerce product with this SKU
//
// Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET (read access is enough)

import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local'), quiet: true })

const { getAdminClient } = await import('../lib/supabase.ts')
const { loadExportData } = await import('../lib/woo-export-load.ts')
const { WOO_CATEGORY_PATHS } = await import('../lib/woo-categories.ts')
const XLSX = createRequire(import.meta.url)('xlsx')

const missing = ['WOO_STORE_URL', 'WOO_CONSUMER_KEY', 'WOO_CONSUMER_SECRET'].filter((k) => !process.env[k])
if (missing.length) {
  console.error(`Missing in .env.local: ${missing.join(', ')}`)
  process.exit(1)
}
const raw = process.env.WOO_STORE_URL!
const BASE = (/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).replace(/\/+$/, '')
const AUTH = 'Basic ' + Buffer.from(`${process.env.WOO_CONSUMER_KEY}:${process.env.WOO_CONSUMER_SECRET}`).toString('base64')

async function wooAll<T>(endpoint: string, fields: string, extra = ''): Promise<T[]> {
  const out: T[] = []
  for (let page = 1; ; page++) {
    const res = await fetch(`${BASE}/wp-json/wc/v3/${endpoint}?per_page=100&page=${page}&_fields=${fields}${extra}`, { headers: { Authorization: AUTH } })
    if (!res.ok) throw new Error(`WooCommerce ${endpoint} page ${page}: HTTP ${res.status}`)
    const batch = (await res.json()) as T[]
    out.push(...batch)
    if (!batch.length || page >= Number(res.headers.get('x-wp-totalpages') ?? 1)) break
  }
  return out
}

const dec = (s: string) => String(s).replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&gt;/g, '>')
const norm = (s: string) => s.trim().toLowerCase()

// ---- WooCommerce ----
interface WooCat { id: number; name: string; parent: number; count: number }
interface WooProduct { id: number; sku: string; name: string; status: string; categories: { id: number }[] }
const cats = await wooAll<WooCat>('products/categories', 'id,name,parent,count')
const catById = new Map(cats.map((c) => [c.id, c]))
const fullPath = (id: number): string => {
  const c = catById.get(id)
  if (!c) return `#${id}`
  return (c.parent ? fullPath(c.parent) + ' > ' : '') + dec(c.name)
}
const wooPaths = new Set(cats.map((c) => norm(fullPath(c.id))))
const wooProducts = await wooAll<WooProduct>('products', 'id,sku,name,status,categories', '&status=any')
const wooBySku = new Map<string, WooProduct>()
for (const p of wooProducts) if (p.sku) wooBySku.set(norm(p.sku), p)
console.log(`WooCommerce: ${cats.length} categories, ${wooProducts.length} products (${wooBySku.size} with a SKU)`)

// ---- Catalog ----
const { products, categoryOf } = await loadExportData(getAdminClient())
const visible = products.filter((p) => p.is_active && !p.manually_hidden)
console.log(`Catalog: ${visible.length} visible products`)

// ---- Compare ----
type Result = 'match' | 'subcategory' | 'parent only' | 'different' | 'uncategorized' | 'guess mapping' | 'no mapping' | 'not on Woo'
const rows: Record<string, string>[] = []
const counts = new Map<Result, number>()
const byCatalogCat = new Map<string, Map<Result, number>>()

for (const p of visible) {
  const catalogCat = categoryOf(p) ?? '(none)'
  const map = WOO_CATEGORY_PATHS[catalogCat]
  const woo = wooBySku.get(norm(p.sku ?? ''))
  const wooCatPaths = woo ? woo.categories.map((c) => fullPath(c.id)) : []
  const real = wooCatPaths.filter((c) => norm(c) !== 'uncategorized')
  let result: Result
  if (!woo) result = 'not on Woo'
  else if (!map) result = 'no mapping'
  else if (real.some((c) => norm(c) === norm(map.path))) result = map.guess ? 'guess mapping' : 'match'
  else if (real.some((c) => norm(c).startsWith(norm(map.path) + ' >'))) result = map.guess ? 'guess mapping' : 'subcategory'
  else if (!real.length) result = 'uncategorized'
  else if (real.some((c) => norm(map.path).startsWith(norm(c) + ' >'))) result = 'parent only'
  else result = map.guess ? 'guess mapping' : 'different'

  counts.set(result, (counts.get(result) ?? 0) + 1)
  const per = byCatalogCat.get(catalogCat) ?? new Map<Result, number>()
  per.set(result, (per.get(result) ?? 0) + 1)
  byCatalogCat.set(catalogCat, per)

  rows.push({
    Result: result,
    SKU: p.sku ?? '',
    Name: p.name,
    'Catalog category': catalogCat,
    'Expected on WooCommerce': map?.path ?? '',
    'Actually on WooCommerce': wooCatPaths.join(' | '),
    'Woo status': woo?.status ?? '',
    'Woo product ID': woo ? String(woo.id) : '',
  })
}

// Mapping targets that don't exist as a WooCommerce category.
const deadMappings = Object.entries(WOO_CATEGORY_PATHS).filter(([, m]) => !wooPaths.has(norm(m.path)))
// Catalog categories in use that have no mapping.
const unmapped = [...byCatalogCat.keys()].filter((c) => !WOO_CATEGORY_PATHS[c]).sort()

const ORDER: Result[] = ['match', 'subcategory', 'parent only', 'different', 'uncategorized', 'guess mapping', 'no mapping', 'not on Woo']
console.log('\nPer product:')
for (const r of ORDER) console.log(`  ${r.padEnd(14)} ${counts.get(r) ?? 0}`)
console.log(`\nMapped WooCommerce paths that don't exist on WooCommerce: ${deadMappings.length ? deadMappings.map(([k, m]) => `${k} -> ${m.path}`).join('; ') : 'none'}`)
console.log(`Catalog categories with no WooCommerce mapping: ${unmapped.length ? unmapped.join(', ') : 'none'}`)

// ---- Write ----
const date = new Date().toISOString().slice(0, 10)
const wb = XLSX.utils.book_new()
const summary = [...byCatalogCat].sort((a, b) => a[0].localeCompare(b[0])).map(([cat, per]) => {
  const total = [...per.values()].reduce((a, b) => a + b, 0)
  const row: Record<string, string | number> = {
    'Catalog category': cat,
    'WooCommerce path': WOO_CATEGORY_PATHS[cat]?.path ?? '(no mapping)',
    Guess: WOO_CATEGORY_PATHS[cat]?.guess ? 'yes' : '',
    Products: total,
  }
  for (const r of ORDER) row[r] = per.get(r) ?? 0
  row['% match'] = Math.round((100 * (per.get('match') ?? 0)) / total)
  return row
})
const problems = rows.filter((r) => r.Result !== 'match' && r.Result !== 'subcategory').sort((a, b) => ORDER.indexOf(a.Result as Result) - ORDER.indexOf(b.Result as Result) || a['Catalog category'].localeCompare(b['Catalog category']) || a.SKU.localeCompare(b.SKU))
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'By category')
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(problems.length ? problems : [{ Result: 'Every visible product matches' }]), 'Not matching')
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cats.map((c) => ({ 'WooCommerce category': fullPath(c.id), Products: c.count, ID: c.id })).sort((a, b) => a['WooCommerce category'].localeCompare(b['WooCommerce category']))), 'Woo categories')
const out = path.join(ROOT, 'data', `woo-category-compare-${date}.xlsx`)
XLSX.writeFile(wb, out)
console.log(`\nWrote ${path.relative(ROOT, out)}`)
