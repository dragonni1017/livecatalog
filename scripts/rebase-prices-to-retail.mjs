// rebase-prices-to-retail.mjs
//
// Dragon's decision 2026-08-04 (see docs/memory/project-erply-customer-tiers.md):
// flip the pricing model from "base is the floor, tiers markup from base" to
// "retail is the sticker price shown to everyone, tiers get a DISCOUNT off
// it." Concretely: overwrite every Erply product's price/netPrice with the
// current Retail-tier amount (base * 2.4), so the price customers see by
// default (no tier applied) is retail, not base.
//
// This script only does the PRODUCT PRICE half. It does NOT touch Erply's
// price lists (Wholesale/Distribution-Chain/Exclusive) -- see "IMPORTANT"
// below for why and what still needs doing there.
//
// ── Math ─────────────────────────────────────────────────────────────────
// Original formula (docs/memory/project-erply-customer-tiers.md), old base = X:
//   Base = X            Wholesale = 1.20X       Retail = 2.40X (wholesale*2)
//   Distribution-Chain = 1.10X                  Exclusive = 1.50X (wholesale*1.25)
//
// New base (this script writes this) = old Retail = 2.40X.
//
// IMPORTANT: Wholesale/Distribution-Chain/Exclusive price lists are defined
// as Erply price-list rules with a discountPercent relative to whatever the
// product's base price is. Once base = 2.40X instead of X, those 3 price
// lists will compute wrong prices (e.g. Wholesale would come out to 2.88X,
// not 1.20X) UNLESS their discountPercent is also updated to be relative to
// the new base. The correct new values, so the actual dollar prices stay
// identical to today:
//   Wholesale:           discountPercent = 50       (1.20X / 2.40X = 0.50)
//   Distribution-Chain:  discountPercent = 54.1667   (1.10X / 2.40X = 0.458333)
//   Exclusive:           discountPercent = 37.5      (1.50X / 2.40X = 0.625)
//   Retail's own price list becomes redundant (0% off the new base) --
//   consider deactivating it rather than leaving a no-op rule around.
//   Base has priceListId 0 (no price list at all, see project-erply-customer-tiers.md)
//   -- there is nothing to edit for Base; if anyone is ever added to that
//   group they will see the new (retail) base price with no discount. This
//   is an accepted gap because Base is designed to have zero customers.
// This script does NOT write those 3 discountPercent changes -- no prior
// script in this repo has ever edited a price-list rule via API (the
// original 5 price lists were created via ad hoc direct API calls in a
// session, not a script -- see project-erply-customer-tiers.md), so the
// call shape is unverified. Do this part by hand via the same CRM/classic
// API approach used originally, using the 3 numbers above.
//
// ── Safety ───────────────────────────────────────────────────────────────
// Dry run by default: fetches every product (active AND inactive, per
// Dragon's explicit choice 2026-08-04) and writes a CSV of old vs new
// price. Makes ZERO writes to Erply unless run with --apply.
//
// Run with: node scripts/rebase-prices-to-retail.mjs           (dry run, writes CSV only)
//           node scripts/rebase-prices-to-retail.mjs --apply    (writes prices to Erply)
//
// Requires in .env.local: ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD
//
// Writes: data/price-rebase-review/planned-price-changes.csv

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

const RETAIL_MULTIPLIER = 2.4 // old base -> old retail (base * 1.20 * 2.00)

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

// Erply caps at 200 records/page whenever getStockInfo is requested (see
// lib/erply.ts comment) -- not requesting stock info here, but keep the
// same "trust recordsTotal, loop until collected" approach rather than
// assuming a fixed page size holds.
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

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function writeCsv(outPath, header, rows) {
  const lines = [header.join(','), ...rows.map((r) => r.map(csvEscape).join(','))]
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, lines.join('\n') + '\n')
}

// INCIDENT 2026-08-04: this originally sent `price` (not a real saveProduct
// param -- silently ignored) and `netPrice` (which was already 0 for every
// product on read, so this explicitly zeroed netPrice on all 2,871
// products). Per https://learn-api.erply.com/requests/saveproduct,
// saveProduct only accepts `netPrice` and `priceWithVAT` -- "set one of
// them and API will calculate the other" -- so sending netPrice=0 made
// Erply auto-calculate priceWithVAT (the real selling price) as 0 too,
// zeroing the entire catalog. Fixed via scripts/fix-zeroed-prices.mjs
// (restores from this script's own CSV backup) and here: use
// `priceWithVAT` with the real target price, don't touch netPrice at all.
async function saveProductPrice(sessionKey, productID, price) {
  return erplyPost({
    request: 'saveProduct',
    sessionKey,
    productID: String(productID),
    priceWithVAT: price.toFixed(2),
  })
}

async function main() {
  const apply = process.argv.includes('--apply')

  console.log('Fetching all Erply products (active + inactive)...')
  const sessionKey = await erplySessionKey()
  const [active, inactive] = await Promise.all([
    fetchAllProducts(sessionKey, 1),
    fetchAllProducts(sessionKey, 0),
  ])
  const products = [...active, ...inactive]
  console.log(`Fetched ${products.length} products (${active.length} active, ${inactive.length} inactive).`)

  const rows = products.map((p) => {
    const oldPrice = Number(p.price) || 0
    const oldNetPrice = Number(p.netPrice) || 0
    const newPrice = Math.round(oldPrice * RETAIL_MULTIPLIER * 100) / 100
    const newNetPrice = Math.round(oldNetPrice * RETAIL_MULTIPLIER * 100) / 100
    return {
      productID: p.productID,
      sku: p.code,
      name: p.name,
      active: p.active,
      oldPrice,
      newPrice,
      oldNetPrice,
      newNetPrice,
    }
  })

  writeCsv(
    path.join(ROOT, 'data', 'price-rebase-review', 'planned-price-changes.csv'),
    ['productID', 'sku', 'name', 'active', 'oldPrice', 'newPrice', 'oldNetPrice', 'newNetPrice'],
    rows.map((r) => [r.productID, r.sku, r.name, r.active, r.oldPrice, r.newPrice, r.oldNetPrice, r.newNetPrice]),
  )

  console.log(`\nWrote data/price-rebase-review/planned-price-changes.csv (${rows.length} rows).`)
  console.log('\nReminder -- price list discountPercent values to set by hand (not written by this script):')
  console.log('  Wholesale:            50')
  console.log('  Distribution-Chain:   54.1667')
  console.log('  Exclusive:            37.5')
  console.log('  Retail price list:    now redundant (0% off new base) -- consider deactivating')
  console.log('  Base:                 no price list exists (priceListId 0) -- unaffected, unfixable here')

  if (!apply) {
    console.log(`\nDry run only. ${rows.length} products would be updated. Re-run with --apply to write them.`)
    return
  }

  console.log(`\n--apply set. Writing ${rows.length} product prices to Erply...`)
  let ok = 0
  let failed = 0
  for (const r of rows) {
    try {
      await saveProductPrice(sessionKey, r.productID, r.newPrice)
      ok++
    } catch (err) {
      failed++
      console.error(`Failed to update ${r.sku} (productID ${r.productID}): ${err.message}`)
    }
  }
  console.log(`\nDone. ${ok} updated, ${failed} failed.`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
