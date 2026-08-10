// export-data.mjs
//
// Read-only export of three datasets to CSV (intermediate step before
// building formatted .xlsx files):
//   1. All products (Supabase `products` table, ALL rows incl. inactive/
//      hidden) with a has_picture column
//   2. All categories (Supabase `categories` table) with product counts
//   3. All customers (Erply getCustomers, all 3,461) with their tier group
//
// Writes CSVs to ./export-out/. No writes to Supabase or Erply.
// Run with: node export-data.mjs

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(__dirname, '..')
config({ path: path.join(REPO_ROOT, '.env.local') })

const ERPLY_CLIENT_CODE = process.env.ERPLY_CLIENT_CODE
const ERPLY_USERNAME = process.env.ERPLY_USERNAME
const ERPLY_PASSWORD = process.env.ERPLY_PASSWORD
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const OUT_DIR = path.join(REPO_ROOT, 'export-out')
fs.mkdirSync(OUT_DIR, { recursive: true })

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
function writeCsv(filePath, header, rows) {
  const lines = [header.join(','), ...rows.map((r) => r.map(csvEscape).join(','))]
  fs.writeFileSync(filePath, lines.join('\n') + '\n')
  console.log(`Wrote ${filePath} (${rows.length} rows)`)
}

async function selectAll(db, table, columns) {
  const all = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from(table).select(columns).range(from, from + PAGE - 1)
    if (error) throw new Error(`Supabase select ${table} failed: ${error.message}`)
    const batch = data ?? []
    all.push(...batch)
    if (batch.length < PAGE) break
  }
  return all
}

async function erplyPost(params) {
  const body = new URLSearchParams({ clientCode: ERPLY_CLIENT_CODE, ...params })
  const res = await fetch(`https://${ERPLY_CLIENT_CODE}.erply.com/api/`, { method: 'POST', body })
  if (!res.ok) throw new Error(`Erply HTTP ${res.status}`)
  const json = await res.json()
  if (json.status?.responseStatus === 'error') {
    throw new Error(`Erply error ${json.status.errorCode}: ${json.status.errorField ?? 'unknown'}`)
  }
  return json
}

async function main() {
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  // ── 1. Products ─────────────────────────────────────────────────────────
  console.log('Fetching all products from Supabase...')
  const products = await selectAll(
    db,
    'products',
    'sku, barcode, name, description, price_cents, unit_type, stock_qty, is_active, manually_hidden, image_url, image_urls, updated_at, category:categories(name)',
  )
  console.log(`  ${products.length} products fetched.`)

  const productRows = products.map((p) => {
    const hasPicture = Boolean(p.image_url && p.image_url.trim() !== '') ||
      (Array.isArray(p.image_urls) && p.image_urls.length > 0)
    return [
      p.sku,
      p.barcode ?? '',
      p.name,
      p.description ?? '',
      p.category?.name ?? '',
      (p.price_cents / 100).toFixed(2),
      p.unit_type ?? '',
      p.stock_qty,
      p.is_active ? 'active' : 'inactive',
      p.manually_hidden ? 'hidden' : 'visible',
      hasPicture ? 'YES' : 'NO',
      p.image_url ?? '',
      p.updated_at,
    ]
  })
  writeCsv(
    path.join(OUT_DIR, 'products.csv'),
    ['SKU', 'Barcode', 'Name', 'Description', 'Category', 'Price ($)', 'Unit Type', 'Stock Qty', 'Status', 'Visibility', 'Has Picture', 'Image URL', 'Updated At'],
    productRows,
  )
  const noPicCount = productRows.filter((r) => r[10] === 'NO').length
  console.log(`  ${noPicCount} of ${productRows.length} products have NO picture.`)

  // ── 2. Categories ───────────────────────────────────────────────────────
  console.log('\nFetching all categories from Supabase...')
  const categories = await selectAll(db, 'categories', 'id, name, slug')
  console.log(`  ${categories.length} categories fetched.`)

  const countByCategory = new Map()
  for (const p of products) {
    const name = p.category?.name ?? '(none)'
    countByCategory.set(name, (countByCategory.get(name) ?? 0) + 1)
  }
  const categoryRows = categories
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => [c.name, c.slug, countByCategory.get(c.name) ?? 0])
  writeCsv(
    path.join(OUT_DIR, 'categories.csv'),
    ['Category Name', 'Slug', 'Product Count'],
    categoryRows,
  )

  // ── 3. Customers (Erply) ────────────────────────────────────────────────
  console.log('\nFetching all customers from Erply...')
  const auth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  const sessionKey = auth.records[0].sessionKey

  const allCustomers = []
  let pageNo = 1
  let total = Infinity
  while (allCustomers.length < total) {
    const data = await erplyPost({
      request: 'getCustomers',
      sessionKey,
      recordsOnPage: '200',
      pageNo: String(pageNo),
      orderBy: 'customerID',
    })
    total = data.status.recordsTotal ?? allCustomers.length
    allCustomers.push(...data.records)
    if (data.records.length === 0) break
    if (pageNo % 5 === 0) console.log(`  page ${pageNo}: ${allCustomers.length}/${total}`)
    pageNo++
  }
  console.log(`  ${allCustomers.length} customers fetched.`)

  const customerRows = allCustomers.map((c) => [
    c.customerID,
    c.customerType,
    c.fullName || '',
    c.companyName || '',
    c.groupName || '',
    c.email || '',
    c.phone || '',
    c.mobile || '',
    c.address || '',
    c.city || '',
    c.state || '',
    c.postalCode || '',
    c.country || '',
    c.doNotSell ? 'YES' : 'NO',
    c.salesBlocked ? 'YES' : 'NO',
    c.taxExempt ? 'YES' : 'NO',
  ])
  writeCsv(
    path.join(OUT_DIR, 'customers.csv'),
    ['Customer ID', 'Type', 'Full Name', 'Company Name', 'Tier/Group', 'Email', 'Phone', 'Mobile', 'Address', 'City', 'State', 'Postal Code', 'Country', 'Do Not Sell', 'Sales Blocked', 'Tax Exempt'],
    customerRows,
  )

  console.log('\nAll three CSVs written to export-out/. Read-only run, no writes anywhere.')
}

main().catch((err) => {
  console.error('Fatal error:', err.message)
  process.exitCode = 1
})
