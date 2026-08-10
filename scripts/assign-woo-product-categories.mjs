// assign-woo-product-categories.mjs
//
// Backfills WooCommerce product-category assignments by SKU. Root cause
// investigated 2026-08-10: every one of ly-usa.com's 61 WooCommerce
// categories showed a product count of 0 -- sampled products directly in
// wp-admin and confirmed every one sits in "Uncategorized". WooCommerce's
// category taxonomy was clearly built from the same source as Erply's
// product groups (57 of Erply's distinct groupName values match a
// WooCommerce category name almost exactly), it just never had products
// assigned to it.
//
// Source of truth is Erply's own `groupName` per product (classic API
// getProducts), NOT this repo's Supabase `categories` table -- Supabase's
// category set was later merged/renamed (67 -> 43, see
// docs/CATEGORY-CHANGELOG.md) for the livecatalog storefront's own browse
// UX, which is coarser than WooCommerce's still-granular 61 categories
// (e.g. Supabase merged Accessories/Hair Bands/Beanies/Hats into one
// "Accessories & Apparel"; WooCommerce still has all four separately).
// Matching WooCommerce's actual granularity requires Erply's original
// per-product groupName, confirmed live 2026-08-10 to still exist and to
// match WooCommerce's category names name-for-name (case/whitespace
// normalized -- e.g. Erply "Squishy / Slime" vs Woo "Squishy/Slime").
//
// Dry run by default: writes review CSVs, makes ZERO writes to WooCommerce
// unless run with --apply. On --apply, uses wc/v3/products/batch (100 per
// call) rather than one PUT per product -- the `categories` field IS
// writable on wc/v3/products (unlike the customer `role` field, see
// docs/memory/project-woo-role-write-fix.md -- that gotcha was specific to
// the customer resource, not products), but the write is still
// self-verified afterward by re-fetching, not trusted from the batch
// response alone, matching this project's standard pattern for bulk
// production writes.
//
// Run with: node scripts/assign-woo-product-categories.mjs           (dry run, writes CSVs only)
//           node scripts/assign-woo-product-categories.mjs --apply   (writes Woo categories for matched products)
//
// Requires in .env.local:
//   ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD
//   WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET
//
// Writes:
//   data/woo-category-review/planned-category-changes.csv  - sku -> current Woo categories -> target category
//   data/woo-category-review/no-woo-match.csv               - Erply SKUs with no matching Woo product
//   data/woo-category-review/unmapped-erply-group.csv       - Erply groupNames with no matching Woo category (should be ~0)
//
// Known limitation (same as compare-erply-woo.mjs): WooCommerce variable
// products expose SKU on each variation, not the parent -- a variable
// product's parent will show as "no Woo match" here. Not fixed in this
// pass; extend fetchWooProducts() to pull variations if the no-match count
// looks too high for that reason specifically.

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const ERPLY_CLIENT_CODE = process.env.ERPLY_CLIENT_CODE
const ERPLY_USERNAME = process.env.ERPLY_USERNAME
const ERPLY_PASSWORD = process.env.ERPLY_PASSWORD
const WOO_STORE_URL_RAW = process.env.WOO_STORE_URL
const WOO_STORE_URL = WOO_STORE_URL_RAW
  ? (/^https?:\/\//i.test(WOO_STORE_URL_RAW) ? WOO_STORE_URL_RAW : `https://${WOO_STORE_URL_RAW}`).replace(/\/+$/, '')
  : WOO_STORE_URL_RAW
const WOO_CONSUMER_KEY = process.env.WOO_CONSUMER_KEY
const WOO_CONSUMER_SECRET = process.env.WOO_CONSUMER_SECRET

const missing = []
if (!ERPLY_CLIENT_CODE) missing.push('ERPLY_CLIENT_CODE')
if (!ERPLY_USERNAME) missing.push('ERPLY_USERNAME')
if (!ERPLY_PASSWORD) missing.push('ERPLY_PASSWORD')
if (!WOO_STORE_URL) missing.push('WOO_STORE_URL')
if (!WOO_CONSUMER_KEY) missing.push('WOO_CONSUMER_KEY')
if (!WOO_CONSUMER_SECRET) missing.push('WOO_CONSUMER_SECRET')
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

// Normalize for matching only (display uses the original names): lowercase,
// collapse whitespace around "/", trim. Handles "Squishy / Slime" (Erply) vs
// "Squishy/Slime" (Woo) without treating every other name as a false miss.
function normalizeCategoryName(name) {
  return (name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s+/g, ' ')
}

async function fetchErplyProducts() {
  const auth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  const sessionKey = auth.records[0].sessionKey

  async function page(pageNo) {
    const data = await erplyPost({
      request: 'getProducts',
      sessionKey,
      recordsOnPage: '300',
      pageNo: String(pageNo),
      active: '1',
    })
    return { products: data.records, total: data.status.recordsTotal ?? 0 }
  }
  const first = await page(1)
  const all = [...first.products]
  let pageNo = 2
  while (all.length < first.total) {
    const { products } = await page(pageNo)
    if (products.length === 0) break
    all.push(...products)
    pageNo++
  }
  return all.map((p) => ({
    sku: (p.code || String(p.productID)).trim(),
    groupName: (p.groupName ?? '').trim(),
  }))
}

function wooAuthHeader() {
  const token = Buffer.from(`${WOO_CONSUMER_KEY}:${WOO_CONSUMER_SECRET}`).toString('base64')
  return `Basic ${token}`
}

async function fetchWooCategories() {
  const perPage = 100
  let pageNo = 1
  const all = []
  while (true) {
    const url = `${WOO_STORE_URL}/wp-json/wc/v3/products/categories?per_page=${perPage}&page=${pageNo}`
    const res = await fetch(url, { headers: { Authorization: wooAuthHeader() } })
    if (!res.ok) throw new Error(`WooCommerce HTTP ${res.status} on categories page ${pageNo}`)
    const batch = await res.json()
    if (!Array.isArray(batch) || batch.length === 0) break
    all.push(...batch)
    if (batch.length < perPage) break
    pageNo++
  }
  return all.map((c) => ({ id: c.id, name: c.name, slug: c.slug }))
}

const WOO_STATUSES = 'any'

async function fetchWooProducts() {
  const perPage = 100
  let pageNo = 1
  const all = []
  while (true) {
    const url = `${WOO_STORE_URL}/wp-json/wc/v3/products?per_page=${perPage}&page=${pageNo}&status=${WOO_STATUSES}`
    const res = await fetch(url, { headers: { Authorization: wooAuthHeader() } })
    if (!res.ok) throw new Error(`WooCommerce HTTP ${res.status} on products page ${pageNo}`)
    const batch = await res.json()
    if (!Array.isArray(batch) || batch.length === 0) break
    all.push(...batch)
    if (batch.length < perPage) break
    pageNo++
  }
  return all.map((p) => ({
    id: p.id,
    sku: (p.sku ?? '').trim(),
    categories: (p.categories ?? []).map((c) => ({ id: c.id, name: c.name })),
  }))
}

async function batchUpdateCategories(updates) {
  const chunkSize = 100
  const results = { ok: 0, failed: 0, errors: [] }
  for (let i = 0; i < updates.length; i += chunkSize) {
    const chunk = updates.slice(i, i + chunkSize)
    const res = await fetch(`${WOO_STORE_URL}/wp-json/wc/v3/products/batch`, {
      method: 'POST',
      headers: { Authorization: wooAuthHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ update: chunk.map((u) => ({ id: u.wooId, categories: [{ id: u.targetCatId }] })) }),
    })
    if (!res.ok) {
      results.failed += chunk.length
      results.errors.push(`HTTP ${res.status} on batch starting index ${i}`)
      continue
    }
    const body = await res.json()
    for (const item of body.update ?? []) {
      if (item.error) {
        results.failed++
        results.errors.push(`id ${item.id}: ${item.error.message}`)
      } else {
        results.ok++
      }
    }
    console.log(`  batch ${Math.floor(i / chunkSize) + 1}: ${chunk.length} sent`)
  }
  return results
}

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function writeCsv(outPath, header, rows) {
  const lines = [header.join(','), ...rows.map((r) => r.map(csvEscape).join(','))]
  fs.writeFileSync(outPath, lines.join('\n') + '\n')
}

async function main() {
  const apply = process.argv.includes('--apply')

  console.log('Fetching Erply active products (SKU + groupName)...')
  const erplyProducts = await fetchErplyProducts()
  console.log(`  ${erplyProducts.length} Erply products fetched.`)

  console.log('Fetching WooCommerce categories...')
  const wooCategories = await fetchWooCategories()
  console.log(`  ${wooCategories.length} WooCommerce categories fetched.`)
  const catByNormName = new Map(wooCategories.map((c) => [normalizeCategoryName(c.name), c]))

  console.log('Fetching WooCommerce products...')
  const wooProducts = await fetchWooProducts()
  console.log(`  ${wooProducts.length} WooCommerce products fetched.`)
  const wooBySku = new Map(wooProducts.filter((p) => p.sku).map((p) => [p.sku, p]))

  const planned = []
  const noWooMatch = []
  const unmappedGroup = []

  for (const ep of erplyProducts) {
    const targetCat = catByNormName.get(normalizeCategoryName(ep.groupName))
    if (!targetCat) {
      unmappedGroup.push(ep)
      continue
    }
    const wooProduct = wooBySku.get(ep.sku)
    if (!wooProduct) {
      noWooMatch.push(ep)
      continue
    }
    const alreadySet = wooProduct.categories.some((c) => c.id === targetCat.id) && wooProduct.categories.length === 1
    planned.push({
      sku: ep.sku,
      wooId: wooProduct.id,
      currentCategories: wooProduct.categories.map((c) => c.name).join('; ') || '(none)',
      targetCategory: targetCat.name,
      targetCatId: targetCat.id,
      changeNeeded: !alreadySet,
    })
  }

  const reviewDir = path.join(ROOT, 'data', 'woo-category-review')
  fs.mkdirSync(reviewDir, { recursive: true })

  writeCsv(
    path.join(reviewDir, 'planned-category-changes.csv'),
    ['sku', 'wooId', 'currentCategories', 'targetCategory', 'changeNeeded'],
    planned.map((p) => [p.sku, p.wooId, p.currentCategories, p.targetCategory, p.changeNeeded]),
  )
  writeCsv(
    path.join(reviewDir, 'no-woo-match.csv'),
    ['sku', 'groupName'],
    noWooMatch.map((p) => [p.sku, p.groupName]),
  )
  writeCsv(
    path.join(reviewDir, 'unmapped-erply-group.csv'),
    ['sku', 'groupName'],
    unmappedGroup.map((p) => [p.sku, p.groupName]),
  )

  const needChange = planned.filter((p) => p.changeNeeded)
  console.log(`\n=== Summary ===`)
  console.log(`Erply active products: ${erplyProducts.length}`)
  console.log(`Matched to a Woo product by SKU: ${planned.length}`)
  console.log(`  of those, already correctly categorized: ${planned.length - needChange.length}`)
  console.log(`  of those, would change: ${needChange.length}`)
  console.log(`Skipped -- Erply groupName has no matching Woo category: ${unmappedGroup.length}`)
  console.log(`No matching Woo product by SKU: ${noWooMatch.length}`)

  if (unmappedGroup.length > 0) {
    const distinct = [...new Set(unmappedGroup.map((p) => p.groupName))]
    console.log(`\nUnmapped Erply groupNames (${distinct.length} distinct): ${distinct.join(', ')}`)
  }

  if (!apply) {
    console.log(`\nDry run only -- zero writes made. Re-run with --apply to write ${needChange.length} category change(s) to WooCommerce.`)
    console.log(`CSVs written to data/woo-category-review/ for full review.`)
    return
  }

  console.log(`\n--apply set. Writing ${needChange.length} category change(s) to WooCommerce via products/batch...`)
  const updates = needChange.map((p) => ({ wooId: p.wooId, targetCatId: p.targetCatId }))
  const results = await batchUpdateCategories(updates)
  console.log(`\nBatch results: ${results.ok} updated, ${results.failed} failed.`)
  if (results.errors.length > 0) {
    console.log('Errors:')
    for (const e of results.errors.slice(0, 20)) console.log(`  ${e}`)
  }

  console.log('\nVerifying live (re-fetching WooCommerce products, not trusting the batch response alone)...')
  const verifyProducts = await fetchWooProducts()
  const verifyById = new Map(verifyProducts.map((p) => [p.id, p]))
  let verifiedOk = 0
  let verifiedMismatch = 0
  for (const u of needChange) {
    const current = verifyById.get(u.wooId)
    const ok = current && current.categories.length === 1 && current.categories[0].id === u.targetCatId
    if (ok) verifiedOk++
    else verifiedMismatch++
  }
  console.log(`Verified correct: ${verifiedOk} / ${needChange.length}${verifiedMismatch > 0 ? ` -- ${verifiedMismatch} MISMATCH, check data/woo-category-review/planned-category-changes.csv against live Woo` : ''}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
