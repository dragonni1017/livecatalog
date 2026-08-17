// export-erply-cdn-images-inventory.mjs
// Run with: node scripts/export-erply-cdn-images-inventory.mjs
//
// Read-only. Erply's getProducts `images` field badly under-reports which
// products actually have a picture (spot-checked: only 4/2871 active
// products show hasImage=true through getProducts, even though the
// Woo->Erply CDN image backfill uploaded 1,899 images -- see
// docs/memory/project-erply-image-backfill.md). The CDN's own listing
// endpoint (GET https://cdn.erply.com/images, paginated, keyed by
// productId) is the reliable source -- confirmed live 2026-08-17: 6,194
// image records / 1,903 distinct products, all context "erply-product",
// only 1 soft-deleted. This script cross-references that against the full
// active product list to get SKU-level ground truth, plus live stock/price,
// plus whether this repo's own Supabase image_url is *also* set (to spot
// the gap between "has a picture on Erply" and "picture actually backfilled
// into this catalog's own display").
//
// Meant to run locally, not in a sandbox: Erply's API domain isn't
// network-allowlisted there.
//
// Requires in .env.local:
//   ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Writes: data/erply-cdn-images-inventory.xlsx
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

const ERPLY_CLIENT_CODE = process.env.ERPLY_CLIENT_CODE
const ERPLY_USERNAME = process.env.ERPLY_USERNAME
const ERPLY_PASSWORD = process.env.ERPLY_PASSWORD
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const missing = []
if (!ERPLY_CLIENT_CODE) missing.push('ERPLY_CLIENT_CODE')
if (!ERPLY_USERNAME) missing.push('ERPLY_USERNAME')
if (!ERPLY_PASSWORD) missing.push('ERPLY_PASSWORD')
if (!SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL')
if (!SUPABASE_SERVICE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')
if (missing.length > 0) {
  console.error(`Missing in .env.local: ${missing.join(', ')}`)
  process.exit(1)
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

async function verifyUser() {
  const auth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  return { sessionKey: auth.records[0].sessionKey, jwt: auth.records[0].token }
}

async function fetchErplyProducts(sessionKey) {
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

  return all.map((p) => {
    const stockQty = Object.values(p.warehouses ?? {}).reduce((sum, w) => sum + (w.totalInStock ?? 0), 0)
    return {
      productId: p.productID,
      sku: (p.code || String(p.productID)).trim(),
      name: p.name ?? '',
      categoryName: (p.groupName ?? '').trim(),
      price: p.price ?? p.netPrice ?? 0,
      stockQty,
    }
  })
}

// Counts per productId, latest image key per productId (order 1 preferred,
// falling back to whichever comes first) -- only non-deleted, only the
// "erply-product" context (the one confirmed to actually count, per
// docs/memory/project-erply-image-backfill.md).
async function fetchCdnImagesByProductId(jwt) {
  const byProductId = new Map()
  let pageNo = 1
  let total = Infinity
  let seen = 0
  while (seen < total) {
    const res = await fetch(`https://cdn.erply.com/images?page=${pageNo}`, { headers: { JWT: jwt } })
    if (!res.ok) throw new Error(`Erply CDN HTTP ${res.status} on page ${pageNo}`)
    const data = await res.json()
    total = data.totalRecords
    for (const img of data.images) {
      if (img.isDeleted || img.context !== 'erply-product') continue
      const entry = byProductId.get(img.productId) ?? { count: 0, key: img.key }
      entry.count++
      if (img.order === 1) entry.key = img.key
      byProductId.set(img.productId, entry)
    }
    seen += data.images.length
    if (data.images.length === 0) break
    pageNo++
  }
  return byProductId
}

async function fetchSupabaseImageUrls() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const bySku = new Map()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from('products').select('sku, image_url').range(from, from + PAGE - 1)
    if (error) throw new Error(`Supabase read error: ${error.message}`)
    for (const row of data) bySku.set((row.sku || '').trim().toUpperCase(), !!row.image_url)
    if (data.length < PAGE) break
  }
  return bySku
}

async function main() {
  console.log('Authenticating with Erply...')
  const { sessionKey, jwt } = await verifyUser()

  console.log('Fetching active Erply products...')
  const products = await fetchErplyProducts(sessionKey)
  console.log(`  ${products.length} active Erply products`)

  console.log('Fetching Erply CDN image listing (paginated)...')
  const cdnByProductId = await fetchCdnImagesByProductId(jwt)
  console.log(`  ${cdnByProductId.size} distinct products have a live image on Erply's CDN`)

  console.log("Fetching Supabase's own image_url presence for comparison...")
  const supabaseHasImageBySku = await fetchSupabaseImageUrls()

  const tenant = ERPLY_CLIENT_CODE // matches the "assets/{tenant}/image/{hash}" path seen in getProducts' embedded largeURL

  const rows = products
    .filter((p) => cdnByProductId.has(p.productId))
    .map((p) => {
      const cdn = cdnByProductId.get(p.productId)
      return {
        SKU: p.sku,
        Name: p.name,
        Category: p.categoryName,
        Price: p.price,
        'Stock Qty (Erply live)': p.stockQty,
        'Images on Erply CDN': cdn.count,
        // Requires a JWT/sessionKey header to actually load -- see
        // docs/memory/project-erply-image-backfill.md and this script's
        // header note. Not a plain clickable link.
        'Erply CDN Asset Path (auth required)': `/assets/${tenant}/image/${cdn.key}`,
        'Already in livecatalog (Supabase image_url set)':
          supabaseHasImageBySku.get(p.sku.toUpperCase()) ? 'yes' : 'no',
      }
    })
    .sort((a, b) => a.SKU.localeCompare(b.SKU))

  const notYetInCatalog = rows.filter((r) => r['Already in livecatalog (Supabase image_url set)'] === 'no').length
  console.log(`  ${rows.length} active SKUs matched; ${notYetInCatalog} of those have no image_url in Supabase yet`)

  const wb = XLSX.utils.book_new()
  const sheet = XLSX.utils.json_to_sheet(rows)
  sheet['!cols'] = [{ wch: 14 }, { wch: 50 }, { wch: 24 }, { wch: 10 }, { wch: 18 }, { wch: 14 }, { wch: 45 }, { wch: 20 }]
  XLSX.utils.book_append_sheet(wb, sheet, 'Erply CDN Images')

  const outPath = path.join(ROOT, 'data', 'erply-cdn-images-inventory.xlsx')
  XLSX.writeFile(wb, outPath)
  console.log(`Wrote ${rows.length} rows -> ${outPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
