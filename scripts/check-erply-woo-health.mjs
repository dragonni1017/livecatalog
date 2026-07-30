// check-erply-woo-health.mjs
// Run with: node scripts/check-erply-woo-health.mjs
//
// Read-only health check for the Erply integration's known open questions
// (see docs/ERPLY-INTEGRATION-STATUS-HANDOFF.md). Safe to run repeatedly —
// never writes to Supabase or Erply. Intended to be re-run periodically
// (manually or via a scheduled task) to detect when Erply-side state
// changes, without re-deriving the investigation from scratch each time:
//
//   1. Are ERPLY_CLIENT_CODE/USERNAME/PASSWORD set locally?
//   2. Has Erply enabled image API access yet? (images field absent/empty
//      today — see lib/erply.ts comments)
//   3. Is Erply's own inventory still all-zero, or has real stock been
//      entered? (sampled across a handful of products' `warehouses` dict)
//   4. Has the "active in Supabase but missing from Erply's active feed"
//      count moved from the documented baseline of 146?
//
// Mirrors the fetch/normalize logic in lib/erply.ts and
// scripts/preview-erply-sync.mjs (kept in sync manually, same as that
// script — see its header comment for why this doesn't import lib/erply.ts).

import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

config({ path: path.join(ROOT, '.env.local') })

// 146 originally (2026-07-30 AM); dropped to 143 same evening after the
// F286606 duplicate-row fix deactivated 3 non-Erply-matching rows (expected,
// not drift). Update this when a future change is confirmed to explain a
// move, per docs/ERPLY-INTEGRATION-STATUS-HANDOFF.md.
const DEACTIVATE_BASELINE = 143

const ERPLY_CLIENT_CODE = process.env.ERPLY_CLIENT_CODE
const ERPLY_USERNAME = process.env.ERPLY_USERNAME
const ERPLY_PASSWORD = process.env.ERPLY_PASSWORD
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

console.log('=== Erply/Woo integration health check ===')
console.log(`(run at ${new Date().toISOString()})\n`)

// ── Check 1: credentials present ────────────────────────────────────────────

console.log('--- 1. Local Erply credentials (.env.local) ---')
const credsPresent = {
  ERPLY_CLIENT_CODE: Boolean(ERPLY_CLIENT_CODE),
  ERPLY_USERNAME: Boolean(ERPLY_USERNAME),
  ERPLY_PASSWORD: Boolean(ERPLY_PASSWORD),
}
for (const [key, present] of Object.entries(credsPresent)) {
  console.log(`  ${present ? 'PASS' : 'MISSING'} — ${key} ${present ? 'is set' : 'is NOT set'}`)
}
const allCredsPresent = Object.values(credsPresent).every(Boolean)

if (!allCredsPresent) {
  console.log('\nErply credentials incomplete — skipping live checks 2-4.')
  console.log('(This only reflects .env.local. Separately confirm prod status with:')
  console.log(' npx vercel env ls production 2>&1 | grep -i erply)')
  process.exit(0)
}

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('\nMissing Supabase credentials in .env.local — cannot run check 4.')
  process.exit(1)
}

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

async function getAllActiveProducts(sessionKey) {
  // Same pagination fix as lib/erply.ts: Erply caps pages at 200 records
  // whenever getStockInfo=1 is passed, regardless of recordsOnPage — loop
  // until the accumulated count matches recordsTotal, don't precompute a
  // page count from a fixed page size.
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
  console.log('\nAuthenticating with Erply...')
  const auth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  const sessionKey = auth.records[0].sessionKey

  console.log('Fetching all active Erply products (for checks 2-4)...')
  const products = await getAllActiveProducts(sessionKey)
  console.log(`  ${products.length} active products fetched`)

  // ── Check 2: image API access ─────────────────────────────────────────────

  console.log('\n--- 2. Erply image API access ---')
  const sample = products.slice(0, Math.min(2, products.length))
  let anyImages = false
  for (const p of sample) {
    const has = Array.isArray(p.images) && p.images.length > 0
    if (has) anyImages = true
    console.log(`  ${p.code ?? p.productID}: images field ${p.images === undefined ? 'ABSENT' : has ? `present (${p.images.length})` : 'present but empty'}`)
  }
  // Widen the check across the full sample so a spot-check pair that happens
  // to be image-less locally doesn't produce a false "still gated" read.
  const anyImagesFull = products.some((p) => Array.isArray(p.images) && p.images.length > 0)
  console.log(anyImagesFull
    ? '  CHANGED — Erply now returns image data. Re-run scripts/preview-erply-sync.mjs before touching skipFields.'
    : '  PASS (still gated) — no product returned image data; skipFields image_url exclusion still needed.')

  // ── Check 3: inventory data quality ───────────────────────────────────────

  console.log('\n--- 3. Erply inventory (warehouses stock) ---')
  const stockSample = products.slice(0, Math.min(10, products.length))
  let anyNonZero = false
  const nonZeroSkus = []
  for (const p of stockSample) {
    const total = Object.values(p.warehouses ?? {}).reduce((sum, w) => sum + (w.totalInStock ?? 0), 0)
    if (total > 0) {
      anyNonZero = true
      nonZeroSkus.push(`${p.code ?? p.productID}=${total}`)
    }
  }
  // Also scan the full active set (cheap, already fetched) rather than just
  // the 10-item sample, so a nonzero SKU outside the sample isn't missed.
  const totalNonZero = products.filter(
    (p) => Object.values(p.warehouses ?? {}).reduce((sum, w) => sum + (w.totalInStock ?? 0), 0) > 0
  ).length
  console.log(`  sampled ${stockSample.length} products: ${anyNonZero ? `nonzero stock found (${nonZeroSkus.join(', ')})` : 'all zero'}`)
  console.log(totalNonZero === 0
    ? `  PASS (still all-zero) — 0 of ${products.length} active products have nonzero stock; skipFields stock_qty exclusion still needed.`
    : `  CHANGED — ${totalNonZero} of ${products.length} active products now have nonzero stock. Re-run scripts/preview-erply-sync.mjs before touching skipFields.`)

  // ── Check 4: deactivate-candidate count vs baseline ───────────────────────

  console.log('\n--- 4. Active-in-Supabase-but-missing-from-Erply count ---')
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const existingRows = await selectAll((from, to) =>
    supabase.from('products').select('sku, is_active').range(from, to)
  )
  const activeSupabaseSkus = new Set(existingRows.filter((r) => r.is_active).map((r) => r.sku))
  const erplyActiveSkus = new Set(products.map((p) => (p.code || String(p.productID)).trim()))
  const missingFromErply = [...activeSupabaseSkus].filter((sku) => !erplyActiveSkus.has(sku))

  console.log(`  current count: ${missingFromErply.length} (documented baseline: ${DEACTIVATE_BASELINE})`)
  if (missingFromErply.length === DEACTIVATE_BASELINE) {
    console.log('  PASS — unchanged from baseline.')
  } else {
    console.log(`  CHANGED — moved from ${DEACTIVATE_BASELINE} to ${missingFromErply.length}. Re-review before ever letting a real sync deactivate products.`)
    console.log(`  sample: ${missingFromErply.slice(0, 10).join(', ')}`)
  }

  console.log('\n=== Summary ===')
  console.log(`Erply live in prod: not checked by this script — run \`npx vercel env ls production 2>&1 | grep -i erply\` separately.`)
  console.log('This script only reads. No Supabase or Erply writes were made.')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
