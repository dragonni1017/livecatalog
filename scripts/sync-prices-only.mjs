// sync-prices-only.mjs
//
// Scoped, safe price-only push from Erply -> Supabase (livecatalog). Unlike
// a full app/api/sync/route.ts run, this ONLY writes `price_cents` on rows
// that already exist (matched by sku). It never inserts new rows, never
// deactivates anything, and never touches stock_qty/image_url/category --
// avoiding the 143-product deactivation risk flagged by
// scripts/preview-erply-sync.mjs (unreviewed active-in-Supabase-but-not-in-
// Erply SKUs) and the stock/image nulling risk from Erply's own zeroed
// inventory / ungated-but-sparse images.
//
// Price formula matches lib/erply.ts's normalizeProduct exactly (decided
// 2026-08-06): Erply's stored price (the retail-anchor amount) x
// WHOLESALE_DISCOUNT (0.5) = the storefront display price, matching Erply's
// actual live Wholesale price list discount -- then rounded to the nearest
// quarter, skipping .75 (x.00/x.25/x.50/next-whole-dollar). See the comment
// above WHOLESALE_DISCOUNT in lib/erply.ts.
//
// Dry run by default: prints a diff summary, writes nothing. --apply writes.
//
// Run with: node sync-prices-only.mjs           (dry run)
//           node sync-prices-only.mjs --apply     (writes to Supabase)
//
// Requires in .env.local: ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD,
// NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

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

const WHOLESALE_DISCOUNT = 0.5
const ERPLY_API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`

// Mirrors roundToQuarterSkip75 in lib/erply.ts -- keep both in sync.
function roundToQuarterSkip75(amount) {
  const dollars = Math.floor(amount)
  const cents = Math.round((amount - dollars) * 100)
  const stops = [0, 25, 50, 100]
  let nearest = stops[0]
  let minDiff = Infinity
  for (const stop of stops) {
    const diff = Math.abs(cents - stop)
    if (diff < minDiff) {
      minDiff = diff
      nearest = stop
    }
  }
  return nearest === 100 ? dollars + 1 : dollars + nearest / 100
}

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

// No getStockInfo/getImages requested here (don't need them), so Erply's
// 200-record cap (triggered only by getStockInfo, see
// docs/memory/project-erply-pagination-fix.md) doesn't apply -- still use
// the accumulate-until-total loop rather than a precomputed page count, per
// that note's guidance.
async function fetchAllActiveProducts(sessionKey) {
  const pageSize = 300
  let pageNo = 1
  const all = []
  while (true) {
    const data = await erplyPost({
      request: 'getProducts',
      sessionKey,
      recordsOnPage: String(pageSize),
      pageNo: String(pageNo),
      active: '1',
    })
    all.push(...data.records)
    const total = data.status.recordsTotal ?? all.length
    if (all.length >= total || data.records.length === 0) break
    pageNo++
  }
  return all
}

async function selectAllSkuPrices(db) {
  const all = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from('products').select('sku, price_cents').range(from, from + PAGE - 1)
    if (error) throw new Error(`Supabase select failed: ${error.message}`)
    const batch = data ?? []
    all.push(...batch)
    if (batch.length < PAGE) break
  }
  return all
}

async function main() {
  const apply = process.argv.includes('--apply')

  console.log('Fetching active Erply products...')
  const sessionKey = await erplySessionKey()
  const erplyProducts = await fetchAllActiveProducts(sessionKey)
  console.log(`Fetched ${erplyProducts.length} active products from Erply.`)

  const erplyBySku = new Map(
    erplyProducts.map((p) => {
      const raw = Number(p.price) || Number(p.netPrice) || 0
      const price_cents = Math.round(roundToQuarterSkip75(raw * WHOLESALE_DISCOUNT) * 100)
      return [p.code, { price_cents, name: p.name }]
    }),
  )

  console.log('Loading current Supabase product prices...')
  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  const supaRows = await selectAllSkuPrices(db)
  console.log(`Loaded ${supaRows.length} existing products from Supabase.`)

  const updates = []
  let matched = 0
  let unchanged = 0
  let noMatchInErply = 0

  for (const row of supaRows) {
    const erply = erplyBySku.get(row.sku)
    if (!erply) {
      noMatchInErply++
      continue
    }
    matched++
    if (erply.price_cents === row.price_cents) {
      unchanged++
    } else {
      updates.push({ sku: row.sku, name: erply.name, from: row.price_cents, to: erply.price_cents })
    }
  }

  console.log(`\n=== Summary ===`)
  console.log(`Supabase products matched to an active Erply SKU: ${matched}`)
  console.log(`Already correct (no change needed): ${unchanged}`)
  console.log(`Would be updated: ${updates.length}`)
  console.log(`Supabase products with no active-Erply match (left untouched, not deactivated): ${noMatchInErply}`)
  if (updates.length) {
    console.log('\nSample changes (first 10):')
    for (const u of updates.slice(0, 10)) {
      console.log(`  ${u.sku} (${u.name.slice(0, 40)}): $${(u.from / 100).toFixed(2)} -> $${(u.to / 100).toFixed(2)}`)
    }
  }

  if (!apply) {
    console.log(`\nDry run only -- zero writes made. Re-run with --apply to write ${updates.length} price updates to Supabase.`)
    return
  }

  console.log(`\n--apply set. Writing ${updates.length} price_cents updates to Supabase (price_cents only, nothing else)...`)
  const now = new Date().toISOString()
  let ok = 0
  let failed = 0
  const CHUNK = 15 // low concurrency -- higher values (200) caused "fetch failed" from connection exhaustion
  const stillFailed = []

  async function updateOne(u, attempt = 1) {
    const { error } = await db
      .from('products')
      .update({ price_cents: u.to, updated_at: now })
      .eq('sku', u.sku)
    if (error) {
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 300 * attempt))
        return updateOne(u, attempt + 1)
      }
      failed++
      stillFailed.push(u.sku)
      console.error(`Failed to update ${u.sku} after 3 attempts: ${error.message}`)
    } else {
      ok++
    }
  }

  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK)
    await Promise.all(chunk.map((u) => updateOne(u)))
    if ((i / CHUNK) % 10 === 0) console.log(`  progress: ${Math.min(i + CHUNK, updates.length)}/${updates.length}`)
  }
  console.log(`\nDone. ${ok} updated, ${failed} failed.`)
  if (stillFailed.length) console.log('Still-failed SKUs:', stillFailed.join(', '))
}

main().catch((err) => {
  console.error('Fatal error:', err.message)
  process.exitCode = 1
})
