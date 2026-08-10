// restore-original-prices.mjs
//
// Reverts Erply product prices back to what they were BEFORE the 2026-08
// price-tier project (before rebase-prices-to-retail.mjs's 2.4x rebase).
// Reads oldPrice/oldNetPrice from the backup CSV written on 2026-08-04
// (data/price-rebase-review/planned-price-changes.csv) and writes oldPrice
// back onto each product via `priceWithVAT` (the only real saveProduct price
// param, per the incident documented in docs/memory/project-retail-anchor-
// pricing-flip.md -- never send a bare `price` or an unconfirmed `netPrice`).
//
// Safety, matching this repo's established pattern for bulk Erply writes:
// - Dry run by default. Fetches CURRENT LIVE prices from Erply (does not
//   trust the CSV's `newPrice` column as still-current) and diffs them
//   against the CSV's `oldPrice` (the restore target) so you can see exactly
//   what would change before anything is written.
// - Flags any product whose current live price does NOT match the CSV's
//   `newPrice` -- i.e. something changed it since 2026-08-04 -- so those
//   aren't silently overwritten without visibility.
// - Requires --apply to write anything.
//
// Run with: node restore-original-prices.mjs           (dry run, read-only)
//           node restore-original-prices.mjs --apply    (writes to Erply)
//
// Requires in .env.local: ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD
// Reads: data/price-rebase-review/planned-price-changes.csv

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
const CSV_PATH = path.join(REPO_ROOT, 'data', 'price-rebase-review', 'planned-price-changes.csv')

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

function parseCsv(text) {
  const lines = text.trim().split('\n')
  const header = lines[0].split(',')
  return lines.slice(1).map((line) => {
    const values = []
    let cur = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (inQuotes) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++ }
        else if (c === '"') inQuotes = false
        else cur += c
      } else if (c === '"') inQuotes = true
      else if (c === ',') { values.push(cur); cur = '' }
      else cur += c
    }
    values.push(cur)
    const row = {}
    header.forEach((h, i) => (row[h] = values[i]))
    return row
  })
}

async function saveProductPrice(sessionKey, productID, priceWithVAT) {
  return erplyPost({
    request: 'saveProduct',
    sessionKey,
    productID: String(productID),
    priceWithVAT: Number(priceWithVAT).toFixed(2),
  })
}

async function main() {
  const apply = process.argv.includes('--apply')

  if (!fs.existsSync(CSV_PATH)) {
    console.error(`Backup CSV not found at ${CSV_PATH} -- nothing to restore from.`)
    process.exit(1)
  }
  const rows = parseCsv(fs.readFileSync(CSV_PATH, 'utf8'))
  console.log(`Loaded ${rows.length} rows from backup CSV.`)

  console.log('Fetching CURRENT LIVE Erply prices to diff against...')
  const sessionKey = await erplySessionKey()
  const [active, inactive] = await Promise.all([
    fetchAllProducts(sessionKey, 1),
    fetchAllProducts(sessionKey, 0),
  ])
  const liveByID = new Map([...active, ...inactive].map((p) => [String(p.productID), Number(p.price) || 0]))

  let matchesExpectedCurrent = 0
  let driftedFromExpected = 0
  let wouldChange = 0
  let alreadyCorrect = 0
  const driftSamples = []
  const changeSamples = []

  for (const r of rows) {
    const live = liveByID.get(String(r.productID))
    const expectedCurrent = Number(r.newPrice)
    const target = Number(r.oldPrice)

    if (live !== undefined && Math.abs(live - expectedCurrent) < 0.005) {
      matchesExpectedCurrent++
    } else {
      driftedFromExpected++
      if (driftSamples.length < 10) {
        driftSamples.push(`  ${r.sku}: expected live ${expectedCurrent.toFixed(2)}, actually ${live?.toFixed(2) ?? 'MISSING'}`)
      }
    }

    if (live !== undefined && Math.abs(live - target) < 0.005) {
      alreadyCorrect++
    } else {
      wouldChange++
      if (changeSamples.length < 10) {
        changeSamples.push(`  ${r.sku} (${r.name.slice(0, 40)}): ${live?.toFixed(2) ?? '?'} -> ${target.toFixed(2)}`)
      }
    }
  }

  console.log(`\n=== Dry run summary ===`)
  console.log(`Products in backup CSV: ${rows.length}`)
  console.log(`Live price matches the expected post-flip price (${'newPrice'} column): ${matchesExpectedCurrent}`)
  console.log(`Live price has DRIFTED from expected post-flip price (changed by something else since 08-04): ${driftedFromExpected}`)
  if (driftSamples.length) {
    console.log('Drift samples (first 10):')
    console.log(driftSamples.join('\n'))
  }
  console.log(`\nAlready at target (pre-tier) price: ${alreadyCorrect}`)
  console.log(`Would be changed by this run: ${wouldChange}`)
  if (changeSamples.length) {
    console.log('Change samples (first 10):')
    console.log(changeSamples.join('\n'))
  }

  if (!apply) {
    console.log(`\nDry run only -- zero writes made. Re-run with --apply to write ${wouldChange} price changes to Erply.`)
    return
  }

  console.log(`\n--apply set. Restoring ${rows.length} product prices to pre-tier values via priceWithVAT...`)
  let ok = 0
  let failed = 0
  for (const r of rows) {
    try {
      await saveProductPrice(sessionKey, r.productID, r.oldPrice)
      ok++
    } catch (err) {
      failed++
      console.error(`Failed to restore ${r.sku} (productID ${r.productID}): ${err.message}`)
    }
  }
  console.log(`\nDone. ${ok} restored, ${failed} failed.`)
}

main().catch((err) => {
  console.error('Fatal error:', err.message)
  process.exitCode = 1
})
