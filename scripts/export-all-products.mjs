// export-all-products.mjs
// Run with: node scripts/export-all-products.mjs
//
// Read-only. Full product export (all rows, active + inactive + hidden).
// Price comes from Supabase's price_cents -- that IS the live, wholesale-
// adjusted price shown on livecatalog and confirmed clean/in-sync with
// WooCommerce (see docs/memory/project-woo-price-integration-markup-bug.md),
// not Erply's raw retail price. Stock comes from live Erply instead, since
// Supabase's own stock_qty is not reliably kept in sync (see
// docs/memory/project-orphan-sku-review-resolved.md, "price-only
// Erply->Supabase sync" -- reuses the Erply-fetch pattern from
// export-products-with-images-and-inventory.mjs).
//
// Meant to run locally, not in a sandbox: Erply's API domain isn't
// network-allowlisted there.
//
// Requires in .env.local:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD
//
// Writes: data/all-products-export.xlsx
// Writes nothing to Erply, WooCommerce, or Supabase.

import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ERPLY_CLIENT_CODE = process.env.ERPLY_CLIENT_CODE
const ERPLY_USERNAME = process.env.ERPLY_USERNAME
const ERPLY_PASSWORD = process.env.ERPLY_PASSWORD

const missing = []
if (!SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL')
if (!SUPABASE_SERVICE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')
if (!ERPLY_CLIENT_CODE) missing.push('ERPLY_CLIENT_CODE')
if (!ERPLY_USERNAME) missing.push('ERPLY_USERNAME')
if (!ERPLY_PASSWORD) missing.push('ERPLY_PASSWORD')
if (missing.length > 0) {
  console.error(`Missing in .env.local: ${missing.join(', ')}`)
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

async function fetchAllProducts() {
  const all = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('products')
      .select('sku, barcode, name, description, price_cents, category_id, image_url, image_urls, is_active, manually_hidden, unit_type')
      .range(from, from + PAGE - 1)
    if (error) { console.error('Supabase read error:', error.message); process.exit(1) }
    all.push(...data)
    if (data.length < PAGE) break
  }
  return all
}

async function fetchCategories() {
  const { data, error } = await supabase.from('categories').select('id, name')
  if (error) { console.error('Supabase category read error:', error.message); process.exit(1) }
  return new Map(data.map((c) => [c.id, c.name]))
}

const ERPLY_API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`

async function erplyPost(params) {
  const body = new URLSearchParams({ clientCode: ERPLY_CLIENT_CODE, ...params })
  const res = await fetch(ERPLY_API_URL, { method: 'POST', body })
  if (!res.ok) throw new Error(`Erply HTTP ${res.status}`)
  const json = await res.json()
  if (json.status?.responseStatus === 'error') {
    throw new Error(`Erply error ${json.status.errorCode}: ${json.status.errorField ?? 'unknown'}`)
  }
  return json
}

async function fetchErplyProducts() {
  const auth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  const sessionKey = auth.records[0].sessionKey

  // Erply caps each page at 200 records whenever getStockInfo=1 is passed,
  // regardless of recordsOnPage -- loop until recordsTotal is reached.
  async function page(pageNo) {
    const data = await erplyPost({
      request: 'getProducts',
      sessionKey,
      recordsOnPage: '300',
      pageNo: String(pageNo),
      getStockInfo: '1',
    })
    return { products: data.records, total: data.status.recordsTotal ?? 0 }
  }

  const first = await page(1)
  const all = [...first.products]
  const total = first.total
  let pageNo = 2
  while (all.length < total) {
    const { products } = await page(pageNo)
    if (products.length === 0) break
    all.push(...products)
    pageNo++
  }

  const bySku = new Map()
  for (const p of all) {
    const sku = (p.code || String(p.productID)).trim().toUpperCase()
    const stockQty = Object.values(p.warehouses ?? {}).reduce((sum, w) => sum + Number(w.totalInStock ?? 0), 0)
    bySku.set(sku, { stockQty })
  }
  return bySku
}

async function main() {
  console.log('Fetching all products from Supabase...')
  const products = await fetchAllProducts()
  console.log(`  ${products.length} products`)

  console.log('Fetching categories...')
  const categoriesById = await fetchCategories()

  console.log('Fetching live Erply stock (source of truth -- Supabase stock_qty is not reliably synced)...')
  const erplyBySku = await fetchErplyProducts()
  console.log(`  ${erplyBySku.size} Erply products`)

  let noErplyMatch = 0
  const rows = products
    .map((p) => {
      const erply = erplyBySku.get((p.sku || '').trim().toUpperCase())
      if (!erply) noErplyMatch++
      const hasPicture = Boolean(p.image_url && p.image_url.trim() !== '') || (Array.isArray(p.image_urls) && p.image_urls.length > 0)
      return {
        SKU: p.sku,
        Barcode: p.barcode ?? '',
        Name: p.name,
        Category: categoriesById.get(p.category_id) ?? '',
        'Price ($)': (p.price_cents / 100).toFixed(2),
        'Stock Qty (Erply live)': erply ? erply.stockQty : '',
        'Unit Type': p.unit_type ?? '',
        Status: p.is_active ? 'active' : 'inactive',
        Visibility: p.manually_hidden ? 'hidden' : 'visible',
        'Has Picture': hasPicture ? 'YES' : 'NO',
        'Image URL': p.image_url ?? '',
        'In Erply': erply ? 'YES' : 'NO',
      }
    })
    .sort((a, b) => a.SKU.localeCompare(b.SKU))

  if (noErplyMatch > 0) {
    console.log(`  ${noErplyMatch} of those have no matching SKU in Erply (price/stock left blank)`)
  }

  const wb = XLSX.utils.book_new()
  const sheet = XLSX.utils.json_to_sheet(rows)
  sheet['!cols'] = [
    { wch: 16 }, { wch: 16 }, { wch: 50 }, { wch: 24 }, { wch: 14 },
    { wch: 18 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 12 },
    { wch: 60 }, { wch: 10 },
  ]
  XLSX.utils.book_append_sheet(wb, sheet, 'All Products')

  const outPath = path.join(ROOT, 'data', 'all-products-export.xlsx')
  XLSX.writeFile(wb, outPath)
  console.log(`Wrote ${rows.length} rows -> ${outPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
