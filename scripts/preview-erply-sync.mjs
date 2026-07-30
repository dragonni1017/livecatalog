// preview-erply-sync.mjs
// Run with: node scripts/preview-erply-sync.mjs
//
// Read-only dry run of what a real Erply sync (app/api/sync/route.ts calling
// lib/erply.ts's getErplyProducts()) would do to Supabase RIGHT NOW, using
// the same fixed pagination/field logic as lib/erply.ts (kept in sync with it
// manually -- this script intentionally doesn't import lib/erply.ts, matching
// the rest of scripts/*.mjs, which don't pull in Next's TS module graph).
//
// Reports what lib/product-sync.ts's previewSync() reports (insert / update /
// deactivate / new categories) PLUS two things previewSync() itself doesn't
// check but that this investigation found are the real risk right now:
//   - how many products would have their image_url overwritten to null
//     (Erply's images access isn't enabled yet, so every incoming product's
//     imageUrl resolves to null -- a real sync today would wipe out all
//     working Cloudinary image_urls)
//   - how many products would have their stock_qty overwritten to 0
//     (Erply's own inventory reads 0 catalog-wide right now, confirmed live)
//
// Writes nothing to Supabase or Erply.

import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

config({ path: path.join(ROOT, '.env.local') })

const ERPLY_CLIENT_CODE = process.env.ERPLY_CLIENT_CODE
const ERPLY_USERNAME = process.env.ERPLY_USERNAME
const ERPLY_PASSWORD = process.env.ERPLY_PASSWORD
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!ERPLY_CLIENT_CODE || !ERPLY_USERNAME || !ERPLY_PASSWORD) {
  console.error('Missing Erply credentials in .env.local.')
  process.exit(1)
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing Supabase credentials in .env.local.')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
const API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`

async function erplyPost(params) {
  const body = new URLSearchParams({ clientCode: ERPLY_CLIENT_CODE, ...params })
  const res = await fetch(API_URL, { method: 'POST', body })
  if (!res.ok) throw new Error(`Erply HTTP ${res.status}`)
  const json = await res.json()
  if (json.status?.responseStatus === 'error') {
    throw new Error(`Erply error ${json.status.errorCode}: ${json.status.errorField ?? 'unknown'}`)
  }
  return json
}

async function getAllErplyProducts() {
  const auth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  const sessionKey = auth.records[0].sessionKey

  async function page(pageNo) {
    const data = await erplyPost({
      request: 'getProducts',
      sessionKey,
      recordsOnPage: '300',
      pageNo: String(pageNo),
      getImages: '1',
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
  return all
}

function normalize(p) {
  const primaryImage = p.images?.[0]
  const stockQty = Object.values(p.warehouses ?? {}).reduce((sum, w) => sum + (w.totalInStock ?? 0), 0)
  return {
    sku: (p.code || String(p.productID)).trim(),
    categoryName: p.groupName ?? '',
    imageUrl: primaryImage?.fullURL ?? primaryImage?.largeURL ?? null,
    stockQty,
  }
}

function slugify(name) {
  return name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
}

async function selectAll(makeQuery) {
  const all = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const batch = data ?? []
    all.push(...batch)
    if (batch.length < PAGE) break
  }
  return all
}

async function main() {
  console.log('Fetching all active products from Erply (real mode)...')
  const erplyProducts = await getAllErplyProducts().then((raw) => raw.map(normalize))
  console.log(`  ${erplyProducts.length} products fetched from Erply`)

  console.log('Loading current Supabase products for comparison...')
  const existingRows = await selectAll((from, to) =>
    supabase.from('products').select('sku, image_url, stock_qty, is_active').range(from, to)
  )
  const existingBySku = new Map(existingRows.map((r) => [r.sku, r]))
  const activeSkus = new Set(existingRows.filter((r) => r.is_active).map((r) => r.sku))

  const { data: catRows } = await supabase.from('categories').select('slug')
  const existingSlugs = new Set((catRows ?? []).map((c) => c.slug))

  const incomingSet = new Set(erplyProducts.map((p) => p.sku))
  const wouldInsert = erplyProducts.filter((p) => !existingBySku.has(p.sku)).length
  const wouldUpdate = erplyProducts.filter((p) => existingBySku.has(p.sku)).length
  const toDeactivate = [...activeSkus].filter((sku) => !incomingSet.has(sku))

  const incomingCats = [...new Set(erplyProducts.map((p) => p.categoryName).filter(Boolean))]
  const newCategories = incomingCats.filter((name) => !existingSlugs.has(slugify(name)))

  let imageWipes = 0
  let stockZeroed = 0
  const imageWipeSample = []
  const stockZeroedSample = []
  for (const p of erplyProducts) {
    const existing = existingBySku.get(p.sku)
    if (!existing) continue
    if (existing.image_url && !p.imageUrl) {
      imageWipes++
      if (imageWipeSample.length < 10) imageWipeSample.push(p.sku)
    }
    if ((existing.stock_qty ?? 0) > 0 && p.stockQty === 0) {
      stockZeroed++
      if (stockZeroedSample.length < 10) stockZeroedSample.push(p.sku)
    }
  }

  console.log('\n=== previewSync()-equivalent (insert / update / deactivate / categories) ===')
  console.log('incoming from Erply:', erplyProducts.length)
  console.log('would insert (new SKUs):', wouldInsert)
  console.log('would update (existing SKUs):', wouldUpdate)
  console.log('would deactivate (active in Supabase, missing from Erply):', toDeactivate.length)
  if (toDeactivate.length) console.log('  sample:', toDeactivate.slice(0, 10))
  console.log('new categories that would be created:', newCategories.length, newCategories.slice(0, 10))

  console.log('\n=== risk this investigation flagged (NOT covered by previewSync()) ===')
  console.log('products that would have a WORKING image_url overwritten to null:', imageWipes, `(sample: ${imageWipeSample.join(', ')})`)
  console.log('products that would have a NONZERO stock_qty overwritten to 0:', stockZeroed, `(sample: ${stockZeroedSample.join(', ')})`)
  console.log('\nConclusion: do NOT point app/api/sync/route.ts at real Erply credentials yet -- image_url and stock_qty need to be excluded from the upsert (or Erply-side data fixed first), or this will erase working data on the first run.')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
