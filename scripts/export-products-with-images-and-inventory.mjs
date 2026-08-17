// export-products-with-images-and-inventory.mjs
// Run with: node scripts/export-products-with-images-and-inventory.mjs
//
// Read-only. "Has a picture" is read from Supabase's products.image_url --
// NOT from Erply's own getProducts `images` field, which under-reports
// badly (spot-checked: only 4/2871 active Erply products show hasImage=true
// via getProducts even though the Woo->Erply image backfill and
// needs_photo work confirm ~2000 products have a real image somewhere; see
// docs/memory/project-erply-image-backfill.md -- Erply's CDN-based image
// API and the getProducts `images` field don't reliably agree). Supabase's
// image_url + needs_photo=false (set by scripts/mark-needs-photo.mjs after
// cross-checking Erply/Woo/Cloudinary/GoDaddy, see migration
// 0023_products_needs_photo.sql) is the vetted source for this.
//
// "Inventory" (stock qty) is read live from Erply directly, matched by SKU
// -- Supabase's own stock_qty is not reliably kept in sync (see
// docs/memory/project-orphan-sku-review-resolved.md, "price-only
// Erply->Supabase sync"), so it is not used here.
//
// Meant to run locally, not in a sandbox: Erply's API domain isn't
// network-allowlisted there.
//
// Requires in .env.local:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD
//
// Writes: data/products-with-images-and-inventory.xlsx
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

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// ── Supabase: products with a real picture ─────────────────────────────────

async function fetchSupabaseProductsWithImages() {
  const all = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('products')
      .select('sku, name, image_url, needs_photo, category_id, is_active')
      .eq('is_active', true)
      .not('image_url', 'is', null)
      .range(from, from + PAGE - 1)
    if (error) { console.error('Supabase read error:', error.message); process.exit(1) }
    all.push(...data)
    if (data.length < PAGE) break
  }
  // needs_photo=true should never coexist with a real image_url, but skip
  // defensively rather than trust that invariant blindly.
  return all.filter((p) => !p.needs_photo)
}

async function fetchCategories() {
  const { data, error } = await supabase.from('categories').select('id, name')
  if (error) { console.error('Supabase category read error:', error.message); process.exit(1) }
  return new Map(data.map((c) => [c.id, c.name]))
}

// ── Erply: live stock + price, same fetch pattern as compare-erply-woo.mjs ─

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
      active: '1',
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
    const stockQty = Object.values(p.warehouses ?? {}).reduce((sum, w) => sum + (w.totalInStock ?? 0), 0)
    bySku.set(sku, { price: p.price ?? p.netPrice ?? 0, stockQty })
  }
  return bySku
}

async function main() {
  console.log('Fetching Supabase products with a real image_url...')
  const products = await fetchSupabaseProductsWithImages()
  console.log(`  ${products.length} active products with a picture`)

  console.log('Fetching categories...')
  const categoriesById = await fetchCategories()

  console.log('Fetching live Erply stock/price...')
  const erplyBySku = await fetchErplyProducts()
  console.log(`  ${erplyBySku.size} active Erply products`)

  let noErplyMatch = 0
  const rows = products
    .map((p) => {
      const erply = erplyBySku.get((p.sku || '').trim().toUpperCase())
      if (!erply) noErplyMatch++
      return {
        SKU: p.sku,
        Name: p.name,
        Category: categoriesById.get(p.category_id) ?? '',
        'Price (Erply)': erply ? erply.price : '',
        'Stock Qty (Erply live)': erply ? erply.stockQty : '',
        'Image URL': p.image_url,
      }
    })
    .sort((a, b) => a.SKU.localeCompare(b.SKU))

  if (noErplyMatch > 0) {
    console.log(`  ${noErplyMatch} of those have no matching active SKU in Erply (price/stock left blank)`)
  }

  const wb = XLSX.utils.book_new()
  const sheet = XLSX.utils.json_to_sheet(rows)
  sheet['!cols'] = [{ wch: 14 }, { wch: 50 }, { wch: 24 }, { wch: 12 }, { wch: 18 }, { wch: 60 }]
  XLSX.utils.book_append_sheet(wb, sheet, 'Products with Images')

  const outPath = path.join(ROOT, 'data', 'products-with-images-and-inventory.xlsx')
  XLSX.writeFile(wb, outPath)
  console.log(`Wrote ${rows.length} rows -> ${outPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
