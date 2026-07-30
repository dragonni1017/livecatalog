// list-erply-deactivate-candidates.mjs
// Run with: node scripts/list-erply-deactivate-candidates.mjs
//
// Read-only. Lists every product active in Supabase but missing from Erply's
// active feed (the "would deactivate" set from preview-erply-sync.mjs), with
// name/price/category so it can actually be reviewed rather than just
// counted. Writes data/erply-review/deactivate-candidates.csv (gitignored by
// convention -- one-off review export, not checked into the repo; see
// docs/ERPLY-INTEGRATION-STATUS-HANDOFF.md TODO #6).
//
// Mirrors the fetch/pagination logic in lib/erply.ts and
// scripts/preview-erply-sync.mjs (kept in sync manually, not imported --
// same reasoning as that script's header comment).

import fs from 'fs'
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

async function getAllErplyActiveSkus() {
  const auth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  const sessionKey = auth.records[0].sessionKey

  async function page(pageNo) {
    // No getImages/getStockInfo needed here -- just codes, so no 200-cap risk,
    // but request the same recordsOnPage as elsewhere for consistency.
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
  const total = first.total
  let pageNo = 2
  while (all.length < total) {
    const { products } = await page(pageNo)
    if (products.length === 0) break
    all.push(...products)
    pageNo++
  }
  return new Set(all.map((p) => (p.code || String(p.productID)).trim()))
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

function csvEscape(value) {
  const s = String(value ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

async function main() {
  console.log('Fetching active SKUs from Erply...')
  const erplyActiveSkus = await getAllErplyActiveSkus()
  console.log(`  ${erplyActiveSkus.size} active SKUs in Erply`)

  console.log('Loading active Supabase products...')
  const rows = await selectAll((from, to) =>
    supabase
      .from('products')
      .select('sku, name, barcode, price_cents, category_id, is_active')
      .eq('is_active', true)
      .range(from, to),
  )
  console.log(`  ${rows.length} active products in Supabase`)

  const { data: categories } = await supabase.from('categories').select('id, name')
  const categoryById = new Map((categories ?? []).map((c) => [c.id, c.name]))

  const candidates = rows
    .filter((r) => !erplyActiveSkus.has(r.sku))
    .map((r) => ({
      sku: r.sku,
      name: r.name,
      barcode: r.barcode ?? '',
      price: ((r.price_cents ?? 0) / 100).toFixed(2),
      category: categoryById.get(r.category_id) ?? '',
    }))
    .sort((a, b) => a.sku.localeCompare(b.sku))

  console.log(`\n${candidates.length} products are active in Supabase but missing from Erply's active feed.`)

  const outDir = path.join(ROOT, 'data', 'erply-review')
  fs.mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, 'deactivate-candidates.csv')
  const header = 'sku,name,barcode,price,category'
  const lines = candidates.map((c) => [c.sku, c.name, c.barcode, c.price, c.category].map(csvEscape).join(','))
  fs.writeFileSync(outPath, [header, ...lines].join('\n') + '\n')

  console.log(`Wrote ${outPath}`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
