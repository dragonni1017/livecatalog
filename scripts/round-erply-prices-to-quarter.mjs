// round-erply-prices-to-quarter.mjs
//
// Rounds Erply's own retail-anchor product prices to the nearest quarter,
// skipping .75 (a price lands on x.00/x.25/x.50, or rounds up to the next
// whole dollar -- never x.75). Same rounding rule as roundToQuarterSkip75()
// in lib/erply.ts / scripts/sync-prices-only.mjs, applied here to the
// SOURCE price in Erply itself rather than the derived storefront price --
// decided 2026-08-06, so POS/Retail-tier prices also land on clean amounts,
// not just the livecatalog display.
//
// Writes via `priceWithVAT` only -- the only real saveProduct price param
// (see the INCIDENT writeup in docs/memory/project-retail-anchor-pricing-
// flip.md: a bare `price` param isn't real, and `netPrice` reads 0 on this
// account for every product, so sending it zeroed real selling prices last
// time). Never send `price` or `netPrice` here.
//
// Safety, matching this repo's established pattern for bulk Erply writes:
// - Dry run by default, --apply required to write.
// - Writes a backup CSV (productID, sku, name, oldPrice, newPrice) to
//   data/price-quarter-round-review/planned-price-changes.csv BEFORE any
//   writes happen, so this is revertible the same way restore-original-
//   prices.mjs reverts the 08-04 rebase.
// - After --apply, re-fetches live prices independently to confirm the
//   write landed -- never trust the writer's own per-call success count.
//
// Run with: node scripts/round-erply-prices-to-quarter.mjs           (dry run)
//           node scripts/round-erply-prices-to-quarter.mjs --apply    (writes)
//
// Requires in .env.local: ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(__dirname, '..')
config({ path: path.join(REPO_ROOT, '.env.local') })

const ERPLY_CLIENT_CODE = process.env.ERPLY_CLIENT_CODE
const ERPLY_USERNAME = process.env.ERPLY_USERNAME
const ERPLY_PASSWORD = process.env.ERPLY_PASSWORD

const missing = []
if (!ERPLY_CLIENT_CODE) missing.push('ERPLY_CLIENT_CODE')
if (!ERPLY_USERNAME) missing.push('ERPLY_USERNAME')
if (!ERPLY_PASSWORD) missing.push('ERPLY_PASSWORD')
if (missing.length > 0) {
  console.error(`Missing in .env.local: ${missing.join(', ')}`)
  process.exit(1)
}

const ERPLY_API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`
const OUT_DIR = path.join(REPO_ROOT, 'data', 'price-quarter-round-review')
const OUT_CSV = path.join(OUT_DIR, 'planned-price-changes.csv')

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

async function saveProductPrice(sessionKey, productID, priceWithVAT) {
  return erplyPost({
    request: 'saveProduct',
    sessionKey,
    productID: String(productID),
    priceWithVAT: Number(priceWithVAT).toFixed(2),
  })
}

function toCsv(rows) {
  const header = 'productID,sku,name,oldPrice,newPrice'
  const lines = rows.map((r) =>
    [r.productID, r.sku, `"${r.name.replace(/"/g, '""')}"`, r.oldPrice.toFixed(2), r.newPrice.toFixed(2)].join(','),
  )
  return [header, ...lines].join('\n') + '\n'
}

async function main() {
  const apply = process.argv.includes('--apply')

  const sessionKey = await erplySessionKey()

  console.log('Fetching all Erply products (active + inactive)...')
  const [active, inactive] = await Promise.all([
    fetchAllProducts(sessionKey, 1),
    fetchAllProducts(sessionKey, 0),
  ])
  const products = [...active, ...inactive]
  console.log(`Fetched ${products.length} products (${active.length} active, ${inactive.length} inactive).`)

  const changes = []
  let alreadyRounded = 0
  for (const p of products) {
    const current = Number(p.price) || Number(p.netPrice) || 0
    const target = roundToQuarterSkip75(current)
    if (Math.abs(current - target) < 0.005) {
      alreadyRounded++
    } else {
      changes.push({ productID: p.productID, sku: p.code, name: p.name, oldPrice: current, newPrice: target })
    }
  }

  console.log(`\n=== Dry run summary ===`)
  console.log(`Total products: ${products.length}`)
  console.log(`Already on a quarter stop (.00/.25/.50/.00-next-dollar): ${alreadyRounded}`)
  console.log(`Would be rounded: ${changes.length}`)
  if (changes.length) {
    console.log('\nSample changes (first 10):')
    for (const c of changes.slice(0, 10)) {
      console.log(`  ${c.sku} (${c.name.slice(0, 40)}): $${c.oldPrice.toFixed(2)} -> $${c.newPrice.toFixed(2)}`)
    }
  }

  if (!apply) {
    console.log(`\nDry run only -- zero writes made. Re-run with --apply to write ${changes.length} price changes to Erply.`)
    return
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(OUT_CSV, toCsv(changes))
  console.log(`\nBackup of planned changes written to ${path.relative(REPO_ROOT, OUT_CSV)} before any writes.`)

  console.log(`\n--apply set. Rounding ${changes.length} product prices via priceWithVAT...`)
  let ok = 0
  let failed = 0
  const stillFailed = []
  for (const c of changes) {
    try {
      await saveProductPrice(sessionKey, c.productID, c.newPrice)
      ok++
    } catch (err) {
      failed++
      stillFailed.push(c.sku)
      console.error(`Failed to round ${c.sku} (productID ${c.productID}): ${err.message}`)
    }
  }
  console.log(`\nDone. ${ok} rounded, ${failed} failed.`)
  if (stillFailed.length) console.log('Still-failed SKUs:', stillFailed.join(', '))

  console.log('\nRe-fetching live prices to independently verify the write (not trusting the count above)...')
  const [reActive, reInactive] = await Promise.all([
    fetchAllProducts(sessionKey, 1),
    fetchAllProducts(sessionKey, 0),
  ])
  const liveByID = new Map(
    [...reActive, ...reInactive].map((p) => [String(p.productID), Number(p.price) || Number(p.netPrice) || 0]),
  )
  let verified = 0
  let mismatched = 0
  const mismatchSamples = []
  for (const c of changes) {
    const live = liveByID.get(String(c.productID))
    if (live !== undefined && Math.abs(live - c.newPrice) < 0.005) {
      verified++
    } else {
      mismatched++
      if (mismatchSamples.length < 10) {
        mismatchSamples.push(`  ${c.sku}: expected ${c.newPrice.toFixed(2)}, live is ${live?.toFixed(2) ?? 'MISSING'}`)
      }
    }
  }
  console.log(`Verified matching live: ${verified}/${changes.length}`)
  if (mismatched) {
    console.log(`MISMATCHED: ${mismatched}`)
    console.log(mismatchSamples.join('\n'))
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message)
  process.exitCode = 1
})
