// calibrate-tier-thresholds.mjs
// Run with: node scripts/calibrate-tier-thresholds.mjs [--lookback-days 365]
//
// Read-only. Pulls confirmed sales documents from Erply (classic API
// getSalesDocuments) over a trailing window, aggregates per customer into
// three purchase signals -- total spend ("amount"), average order value
// ("size"), and orders per month ("frequency") -- and prints percentile
// bands across the whole customer base. Writes those bands to
// scripts/tier-thresholds.json for suggest-customer-tiers.mjs to consume.
//
// Why percentiles instead of guessed dollar figures: nobody has real
// visibility into this account's purchase-size distribution yet (see
// docs/memory/project-erply-customer-tiers.md -- "no criteria has been
// given yet for how to split customers across the 5 tiers"). Rather than
// inventing $ thresholds, this derives them from the account's own actual
// history, so the bands are grounded in what "high volume" vs "low volume"
// really looks like for these 3,461 customers.
//
// Only ranks customers on the volume axis (Distribution-Chain / Wholesale /
// Retail). Base and Exclusive are deliberately left out -- see
// docs/memory/project-tier-auto-suggestion.md for why those two don't map
// cleanly onto purchase volume.
//
// Requires in .env.local (all pre-existing): ERPLY_CLIENT_CODE,
// ERPLY_USERNAME, ERPLY_PASSWORD
//
// Writes only scripts/tier-thresholds.json. Makes zero writes to Erply.

import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')

config({ path: path.join(ROOT, '.env.local') })

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

const args = process.argv.slice(2)
function argValue(flag, fallback) {
  const i = args.indexOf(flag)
  return i === -1 ? fallback : args[i + 1]
}
const LOOKBACK_DAYS = Number(argValue('--lookback-days', '365'))
const MAX_PAGES = Number(argValue('--max-pages', '300')) // safety cap: 300*100 = 30,000 docs

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

async function login() {
  const data = await erplyPost({
    request: 'verifyUser',
    username: ERPLY_USERNAME,
    password: ERPLY_PASSWORD,
  })
  return data.records[0].sessionKey
}

function dateNDaysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10) // yyyy-mm-dd
}

// Pull every confirmed real sale (not quotes/orders, which aren't committed
// purchases) since dateFrom, paginating 100 at a time (Erply's per-page max).
async function fetchAllSalesDocs(sessionKey) {
  const dateFrom = dateNDaysAgo(LOOKBACK_DAYS)
  const docs = []
  let page = 1
  let total = Infinity

  while (docs.length < total && page <= MAX_PAGES) {
    const data = await erplyPost({
      request: 'getSalesDocuments',
      sessionKey,
      types: 'INVOICE,CASHINVOICE,INVWAYBILL',
      confirmed: '1',
      dateFrom,
      recordsOnPage: '100',
      pageNo: String(page),
      orderBy: 'documentID',
    })
    total = data.status.recordsTotal ?? docs.length + data.records.length
    docs.push(...data.records)
    if (page === 1 || page % 10 === 0) {
      console.log(`  page ${page}: ${docs.length}/${total} sales docs fetched`)
    }
    if (data.records.length === 0) break
    page++
  }
  if (page > MAX_PAGES) {
    console.warn(`Hit --max-pages cap (${MAX_PAGES}) before exhausting results -- sample is partial. Re-run with a higher --max-pages if you need the full set.`)
  }
  return docs
}

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0
  const idx = Math.min(sortedArr.length - 1, Math.floor((p / 100) * sortedArr.length))
  return sortedArr[idx]
}

async function main() {
  console.log(`Erply calibration -- trailing ${LOOKBACK_DAYS} days, confirmed INVOICE/CASHINVOICE/INVWAYBILL only.`)
  const sessionKey = await login()
  console.log('Erply auth OK. Fetching sales documents (this may take a while for a full year)...')

  const docs = await fetchAllSalesDocs(sessionKey)
  console.log(`\nFetched ${docs.length} confirmed sales documents.`)

  // Aggregate per customer.
  const byCustomer = new Map()
  for (const d of docs) {
    const clientID = d.clientID
    if (!clientID) continue
    const total = Number(d.total ?? 0)
    if (!byCustomer.has(clientID)) {
      byCustomer.set(clientID, { clientID, clientName: d.clientName ?? '', totalSpend: 0, orderCount: 0 })
    }
    const rec = byCustomer.get(clientID)
    rec.totalSpend += total
    rec.orderCount += 1
  }

  const customers = [...byCustomer.values()].map((c) => ({
    ...c,
    avgOrderValue: c.orderCount > 0 ? c.totalSpend / c.orderCount : 0,
    ordersPerMonth: c.orderCount / (LOOKBACK_DAYS / 30),
  }))

  console.log(`${customers.length} distinct customers had at least one confirmed sale in the window.`)

  if (customers.length < 10) {
    console.warn('\nFewer than 10 customers with purchase history -- percentile bands below will be low-confidence. Consider a longer --lookback-days.')
  }

  const totalSpendSorted = customers.map((c) => c.totalSpend).sort((a, b) => a - b)
  const avgOrderValueSorted = customers.map((c) => c.avgOrderValue).sort((a, b) => a - b)
  const ordersPerMonthSorted = customers.map((c) => c.ordersPerMonth).sort((a, b) => a - b)

  const bands = [20, 40, 60, 80]
  const percentiles = {
    totalSpend: Object.fromEntries(bands.map((p) => [`p${p}`, round2(percentile(totalSpendSorted, p))])),
    avgOrderValue: Object.fromEntries(bands.map((p) => [`p${p}`, round2(percentile(avgOrderValueSorted, p))])),
    ordersPerMonth: Object.fromEntries(bands.map((p) => [`p${p}`, round2(percentile(ordersPerMonthSorted, p))])),
  }

  console.log('\nPercentile bands across customers with purchase history:')
  console.log(JSON.stringify(percentiles, null, 2))

  // Retail = bottom 40% (occasional/small buyers, pay full markup).
  // Wholesale = middle 40% (the default working tier).
  // Distribution-Chain = top 20% (highest volume, best pricing).
  // Base and Exclusive are intentionally excluded -- not derivable from
  // volume alone, see docs/memory/project-tier-auto-suggestion.md.
  const thresholds = {
    generatedAt: new Date().toISOString(),
    lookbackDays: LOOKBACK_DAYS,
    sampleSize: customers.length,
    salesDocsScanned: docs.length,
    percentiles,
    tierBands: {
      retail: {
        note: 'bottom 40% by total spend -- occasional/low-volume buyers',
        totalSpend_max: percentiles.totalSpend.p40,
      },
      wholesale: {
        note: 'middle 40% by total spend -- the default working tier',
        totalSpend_min: percentiles.totalSpend.p40,
        totalSpend_max: percentiles.totalSpend.p80,
      },
      distribution_chain: {
        note: 'top 20% by total spend -- highest volume, best pricing',
        totalSpend_min: percentiles.totalSpend.p80,
      },
    },
  }

  const outPath = path.join(ROOT, 'scripts', 'tier-thresholds.json')
  fs.writeFileSync(outPath, JSON.stringify(thresholds, null, 2))
  console.log(`\nWrote ${outPath}`)
  console.log('Review tierBands before suggest-customer-tiers.mjs uses them -- these are a data-driven starting point, not a final business decision.')
}

function round2(n) {
  return Math.round(n * 100) / 100
}

main().catch((err) => {
  console.error('Fatal error:', err.message)
  // Deliberately process.exitCode (not process.exit()) -- see
  // check-erply-tier-groups.mjs for why (Windows libuv crash otherwise).
  process.exitCode = 1
})
