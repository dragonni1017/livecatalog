// fix-zeroed-prices.mjs
//
// Incident fix, 2026-08-04. scripts/rebase-prices-to-retail.mjs sent a
// `price` param to Erply's saveProduct -- which doesn't exist as a
// parameter on that call (confirmed live via
// https://learn-api.erply.com/requests/saveproduct: saveProduct only
// accepts `netPrice` and `priceWithVAT`, "set one of them and API will
// calculate the other"). It also sent `netPrice`, which was already 0 for
// every product on read (Erply doesn't populate that field on this
// account) -- so every saveProduct call explicitly set netPrice=0, and
// Erply auto-calculated priceWithVAT (the real selling price) as 0 too.
// Result: all 2,871 products' actual selling price became $0 in
// production Erply.
//
// This script re-reads the backup written by the original run
// (data/price-rebase-review/planned-price-changes.csv, which has the
// correct intended retail price per product from BEFORE the bug hit) and
// re-applies it using the correct param (`priceWithVAT`, NOT `price` or
// `netPrice`). Verified live on one product (2745 / T641746: 0 -> 4.80)
// before writing this script.
//
// Dry run by default: prints how many rows would be fixed, makes zero
// writes. Requires --apply to write.
//
// Run with: node scripts/fix-zeroed-prices.mjs           (dry run)
//           node scripts/fix-zeroed-prices.mjs --apply    (writes)
//
// Requires in .env.local: ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD
// Reads: data/price-rebase-review/planned-price-changes.csv

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

const missing = []
if (!ERPLY_CLIENT_CODE) missing.push('ERPLY_CLIENT_CODE')
if (!ERPLY_USERNAME) missing.push('ERPLY_USERNAME')
if (!ERPLY_PASSWORD) missing.push('ERPLY_PASSWORD')
if (missing.length > 0) {
  console.error(`Missing in .env.local: ${missing.join(', ')}`)
  process.exit(1)
}

const ERPLY_API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`
const CSV_PATH = path.join(ROOT, 'data', 'price-rebase-review', 'planned-price-changes.csv')

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

// Minimal CSV parser -- fine here since writeCsv (in the script that
// produced this file) only quotes fields containing comma/quote/newline,
// and none of these columns (productID, sku, name, active, prices) do
// except possibly `name`. Handles quoted fields defensively anyway.
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
  console.log(`Loaded ${rows.length} rows from ${CSV_PATH}.`)
  console.log('Sample:', rows.slice(0, 3).map((r) => `${r.sku}: ${r.newPrice}`).join(', '))

  if (!apply) {
    console.log(`\nDry run only. Would restore priceWithVAT for ${rows.length} products. Re-run with --apply to write.`)
    return
  }

  console.log(`\n--apply set. Restoring ${rows.length} product prices via priceWithVAT...`)
  const sessionKey = await erplySessionKey()
  let ok = 0
  let failed = 0
  for (const r of rows) {
    try {
      await saveProductPrice(sessionKey, r.productID, r.newPrice)
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
