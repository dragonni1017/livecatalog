// check-erply-price-list-rules.mjs
// Read-only. Dumps the live PRODGROUP discount rules for the 4 non-Base
// tier price lists (Wholesale=7, Retail=8, Distribution-Chain=9,
// Exclusive=10 — see docs/memory/project-erply-customer-tiers.md), via
// classic API getPriceLists.
//
// Confirmed live 2026-08-04 against https://learn-api.erply.com/requests/getpricelists:
// filter param is `pricelistID` (lowercase "l"), response has a
// `pricelistRules` array per list: { type, id, discountPercent, price, ruleID }.
// type='PRODGROUP' rules are the per-category markup/discount rules
// project-erply-customer-tiers.md describes; type='PRODUCT'/'SERVICE' rules
// (fixed price overrides) are printed too so nothing is missed.
//
// Run with: node scripts/check-erply-price-list-rules.mjs
// Requires in .env.local: ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD
// Writes nothing anywhere.

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

const PRICE_LISTS = [
  { id: 7, tier: 'Wholesale' },
  { id: 8, tier: 'Retail' },
  { id: 9, tier: 'Distribution-Chain' },
  { id: 10, tier: 'Exclusive' },
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

async function main() {
  const sessionKey = await erplySessionKey()

  for (const { id, tier } of PRICE_LISTS) {
    const data = await erplyPost({ request: 'getPriceLists', sessionKey, pricelistID: String(id) })
    const list = data.records?.[0]
    if (!list) {
      console.log(`\n=== ${tier} (pricelistID ${id}) === NOT FOUND`)
      continue
    }
    const rules = list.pricelistRules ?? []
    console.log(`\n=== ${tier} (pricelistID ${id}) — active=${list.active}, ${rules.length} rule(s) ===`)
    for (const r of rules) {
      console.log(`  type=${r.type} id=${r.id} discountPercent=${r.discountPercent} price=${r.price} ruleID=${r.ruleID}`)
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message)
  process.exitCode = 1
})
