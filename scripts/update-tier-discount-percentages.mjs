// update-tier-discount-percentages.mjs
//
// Second half of the 2026-08-04 pricing flip (see
// scripts/rebase-prices-to-retail.mjs and
// docs/memory/project-woocommerce-tier-mapping.md): now that product base
// price = old Retail price (2.40x old base), the Wholesale/Distribution-
// Chain/Exclusive price lists must be re-anchored so they still produce the
// SAME dollar prices as before -- but as a real discount off the new
// (higher) base instead of a markup off the old (lower) base.
//
// Confirmed live 2026-08-04 via scripts/check-erply-price-list-rules.mjs:
// each of the 4 lists has exactly 7 PRODGROUP rules (ids 1,18,61,36,48,60,56)
// with one uniform discountPercent across all 7 -- no per-category
// customization exists, so a single target % per list is correct.
//
// Math (old base = X, new base = 2.40X):
//   Wholesale:           old target 1.20X -> discountPercent  50        (was -20, a markup)
//   Distribution-Chain:  old target 1.10X -> discountPercent  54.166667 (was -10)
//   Exclusive:            old target 1.50X -> discountPercent 37.5       (was -50)
//   Retail:               old target 2.40X == new base -> discountPercent 0 (was -140;
//     left active at 0% rather than deactivated, so the group->pricelist
//     link doesn't need touching)
// Base: no price list exists (pricelistID 0) -- nothing to update, unaffected.
//
// Uses savePriceList (https://learn-api.erply.com/requests/savepricelist,
// confirmed live 2026-08-04): param name is `pricelistID` (lowercase "l").
// Rules are indexed triplets type#/id#/discountPercent# — "API will only
// update the rules specified in input data and leave all other existing
// rules unchanged", so every existing PRODGROUP id must be resent (read
// live each run, not hardcoded) or older groups would be silently skipped.
//
// Dry run by default: prints old vs new discountPercent per list, makes
// ZERO writes. Requires --apply to actually call savePriceList.
//
// Run with: node scripts/update-tier-discount-percentages.mjs           (dry run)
//           node scripts/update-tier-discount-percentages.mjs --apply    (writes)
//
// Requires in .env.local: ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD

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

const TARGET_LISTS = [
  { id: 7, tier: 'Wholesale', newDiscountPercent: 50 },
  { id: 9, tier: 'Distribution-Chain', newDiscountPercent: 54.166667 },
  { id: 10, tier: 'Exclusive', newDiscountPercent: 37.5 },
  { id: 8, tier: 'Retail', newDiscountPercent: 0 },
]

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

async function fetchPriceListRules(sessionKey, pricelistID) {
  const data = await erplyPost({ request: 'getPriceLists', sessionKey, pricelistID: String(pricelistID) })
  const list = data.records?.[0]
  if (!list) throw new Error(`pricelistID ${pricelistID} not found`)
  return (list.pricelistRules ?? []).filter((r) => r.type === 'PRODGROUP')
}

async function saveDiscountPercent(sessionKey, pricelistID, rules, newDiscountPercent) {
  const params = { request: 'savePriceList', sessionKey, pricelistID: String(pricelistID) }
  rules.forEach((r, i) => {
    const n = i + 1
    params[`type${n}`] = 'PRODGROUP'
    params[`id${n}`] = String(r.id)
    params[`discountPercent${n}`] = String(newDiscountPercent)
  })
  return erplyPost(params)
}

async function main() {
  const apply = process.argv.includes('--apply')
  const sessionKey = await erplySessionKey()

  const plans = []
  for (const target of TARGET_LISTS) {
    const rules = await fetchPriceListRules(sessionKey, target.id)
    plans.push({ ...target, rules })
    console.log(`\n=== ${target.tier} (pricelistID ${target.id}) — ${rules.length} PRODGROUP rule(s) ===`)
    for (const r of rules) {
      console.log(`  group ${r.id}: ${r.discountPercent} -> ${target.newDiscountPercent}`)
    }
  }

  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to write these discountPercent changes.')
    return
  }

  console.log('\n--apply set. Writing discountPercent changes...')
  for (const plan of plans) {
    await saveDiscountPercent(sessionKey, plan.id, plan.rules, plan.newDiscountPercent)
    console.log(`  ${plan.tier} (pricelistID ${plan.id}): updated ${plan.rules.length} rule(s) to ${plan.newDiscountPercent}%`)
  }
  console.log('\nDone.')
}

main().catch((err) => {
  console.error('Fatal error:', err.message)
  process.exitCode = 1
})
