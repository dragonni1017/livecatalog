// check-pos-default-customer.mjs
//
// Diagnoses: "POS buttons show a low/base price, then a tiered customer gets
// marked up" -- Dragon wants the opposite (retail sticker by default, tiered
// customers see a discount). The account-level price data already matches
// that design (see docs/memory/project-retail-anchor-pricing-flip.md: Base
// field on each product = old-retail amount, tier price lists are discounts
// off it). So the likely cause is register-level config, not price data.
//
// Erply's getPointsOfSale (https://learn-api.erply.com/requests/getpointsofsale)
// returns a `defaultCustomerID` per register -- the walk-in customer a sale
// starts as before anyone scans a loyalty card / attaches a real customer.
// If that default customer is sitting in a discounted/marked-up tier group
// (or Base, priceListId 0, meant for 0 customers) instead of Retail, that
// would explain the button price mismatch.
//
// Read-only. No writes. Requires in .env.local: ERPLY_CLIENT_CODE,
// ERPLY_USERNAME, ERPLY_PASSWORD
//
// Run with: node check-pos-default-customer.mjs

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

// Known group IDs / price lists from docs/memory/project-erply-customer-tiers.md
const KNOWN_GROUPS = {
  20: 'Base (priceListId 0 -- internal cost, designed for 0 customers)',
  19: 'Wholesale (priceListId 7)',
  21: 'Retail (priceListId 8)',
  22: 'Distribution-Chain (priceListId 9)',
  23: 'Exclusive (priceListId 10)',
}

async function main() {
  const sessionKey = await erplySessionKey()

  console.log('Fetching registers (getPointsOfSale)...')
  const posData = await erplyPost({ request: 'getPointsOfSale', sessionKey })
  const registers = posData.records ?? []
  console.log(`Found ${registers.length} register(s).\n`)

  for (const r of registers) {
    console.log(`--- Register: ${r.name} (pointOfSaleID ${r.pointOfSaleID}, type ${r.type}, warehouse ${r.warehouseName ?? r.warehouseID}) ---`)
    console.log(`  defaultCustomerID: ${r.defaultCustomerID || '(none set)'}`)

    if (r.defaultCustomerID && Number(r.defaultCustomerID) > 0) {
      try {
        const custData = await erplyPost({
          request: 'getCustomers',
          sessionKey,
          customerID: String(r.defaultCustomerID),
        })
        const cust = custData.records?.[0]
        if (cust) {
          const groupId = cust.groupID
          console.log(`  -> Customer: ${cust.fullName || cust.companyName || '(unnamed)'} (customerID ${cust.customerID})`)
          console.log(`  -> groupID: ${groupId} = ${KNOWN_GROUPS[groupId] || '(unknown group)'}`)
        } else {
          console.log('  -> Could not fetch that customer record.')
        }
      } catch (err) {
        console.log(`  -> Error fetching default customer: ${err.message}`)
      }
    }

    if (Array.isArray(r.quickButtons) && r.quickButtons.length > 0) {
      console.log(`  quickButtons: ${r.quickButtons.length} configured`)
    }
    console.log('')
  }

  console.log('For reference, tier groups in this account:')
  for (const [id, label] of Object.entries(KNOWN_GROUPS)) {
    console.log(`  ${id}: ${label}`)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message)
  process.exitCode = 1
})
