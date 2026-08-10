// investigate-mismatched-skus.mjs
//
// Read-only investigation of the ~146 products active on the livecatalog
// (Supabase) storefront whose SKU doesn't appear in Erply's ACTIVE product
// feed (surfaced by scripts/preview-erply-sync.mjs and
// scripts/sync-prices-only.mjs, both of which deliberately leave these
// untouched rather than deactivating them).
//
// For each mismatched SKU, checks whether it:
//   (a) exists in Erply but is INACTIVE there (active=0) -- likely a real
//       discontinuation that just hasn't been reflected on the storefront
//   (b) doesn't exist in Erply at all, under that exact code -- could be a
//       renamed/retyped SKU, a catalog-only product never in Erply, or a
//       genuine orphan
//
// Writes nothing anywhere. Run with: node investigate-mismatched-skus.mjs

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

async function erplySessionKey() {
  const auth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  return auth.records[0].sessionKey
}

async function fetchAllProducts(sessionKey, activeFlag) {
  const pageSize = 300
  let pageNo = 1
  const all = []
  while (true) {
    const data = await erplyPost({
      request: 'getProducts',
      sessionKey,
      recordsOnPage: String(pageSize),
      pageNo: String(pageNo),
      active: String(activeFlag),
    })
    all.push(...data.records)
    const total = data.status.recordsTotal ?? all.length
    if (all.length >= total || data.records.length === 0) break
    pageNo++
  }
  return all
}

async function selectAllActiveProducts(db) {
  const all = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('products')
      .select('sku, name, price_cents, stock_qty, updated_at')
      .eq('is_active', true)
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`Supabase select failed: ${error.message}`)
    const batch = data ?? []
    all.push(...batch)
    if (batch.length < PAGE) break
  }
  return all
}

async function main() {
  console.log('Fetching Erply products (active + inactive)...')
  const sessionKey = await erplySessionKey()
  const [active, inactive] = await Promise.all([
    fetchAllProducts(sessionKey, 1),
    fetchAllProducts(sessionKey, 0),
  ])
  const activeSkus = new Set(active.map((p) => p.code))
  const inactiveBySkuLower = new Map(inactive.map((p) => [p.code.toLowerCase(), p]))
  const activeBySkuLower = new Map(active.map((p) => [p.code.toLowerCase(), p]))
  console.log(`Erply: ${active.length} active, ${inactive.length} inactive.`)

  console.log('Loading active Supabase products...')
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const supaActive = await selectAllActiveProducts(db)
  console.log(`Supabase: ${supaActive.length} active products.\n`)

  const mismatched = supaActive.filter((r) => !activeSkus.has(r.sku))
  console.log(`Mismatched (active in Supabase, not in Erply's active feed): ${mismatched.length}\n`)

  const categories = {
    inactiveInErply: [],
    caseOrWhitespaceMismatch: [],
    notInErplyAtAll: [],
  }

  for (const row of mismatched) {
    const lower = row.sku.trim().toLowerCase()
    if (inactiveBySkuLower.has(lower) && !activeBySkuLower.has(lower)) {
      // exact-case check
      const exactInactive = inactive.find((p) => p.code === row.sku)
      if (exactInactive) {
        categories.inactiveInErply.push({ ...row, erplyProductID: exactInactive.productID })
      } else {
        categories.caseOrWhitespaceMismatch.push({ ...row, erplyMatch: inactiveBySkuLower.get(lower).code, erplyState: 'inactive' })
      }
    } else if (activeBySkuLower.has(lower)) {
      // case/whitespace mismatch against an ACTIVE erply row -- sync should have caught this but flag it
      categories.caseOrWhitespaceMismatch.push({ ...row, erplyMatch: activeBySkuLower.get(lower).code, erplyState: 'active' })
    } else {
      categories.notInErplyAtAll.push(row)
    }
  }

  console.log(`=== Category breakdown ===`)
  console.log(`1. Exists in Erply but INACTIVE there (likely real discontinuation): ${categories.inactiveInErply.length}`)
  console.log(`2. Case/whitespace SKU mismatch (same product, different SKU casing): ${categories.caseOrWhitespaceMismatch.length}`)
  console.log(`3. Not in Erply at all under any casing (orphan / catalog-only / renamed): ${categories.notInErplyAtAll.length}`)

  console.log(`\n--- Sample: inactive in Erply (first 15) ---`)
  for (const r of categories.inactiveInErply.slice(0, 15)) {
    console.log(`  ${r.sku} (${r.name.slice(0, 45)}) — Erply productID ${r.erplyProductID}, price_cents ${r.price_cents}, stock ${r.stock_qty}`)
  }

  console.log(`\n--- Sample: case/whitespace mismatch (first 15) ---`)
  for (const r of categories.caseOrWhitespaceMismatch.slice(0, 15)) {
    console.log(`  Supabase "${r.sku}" vs Erply "${r.erplyMatch}" (${r.erplyState})`)
  }

  console.log(`\n--- Sample: not in Erply at all (first 20) ---`)
  for (const r of categories.notInErplyAtAll.slice(0, 20)) {
    console.log(`  ${r.sku} (${r.name.slice(0, 50)}) — price_cents ${r.price_cents}, stock ${r.stock_qty}, updated_at ${r.updated_at}`)
  }

  console.log(`\nTotal accounted for: ${categories.inactiveInErply.length + categories.caseOrWhitespaceMismatch.length + categories.notInErplyAtAll.length} / ${mismatched.length}`)
}

main().catch((err) => {
  console.error('Fatal error:', err.message)
  process.exitCode = 1
})
