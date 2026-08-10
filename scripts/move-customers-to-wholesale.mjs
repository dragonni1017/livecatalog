// move-customers-to-wholesale.mjs
//
// Dragon's decision 2026-08-06: move the existing Erply customer list back
// into the Wholesale tier group, so picking a real customer account at POS
// automatically applies their tier discount -- but the POS *default* walk-in
// customer (customerID 3, "POS Customer" -- see
// scripts/check-pos-default-customer.mjs, both physical registers'
// defaultCustomerID) must stay in Retail, so a sale with no customer
// attached still shows full retail price. This is the mirror image of
// scripts/move-all-customers-to-retail.mjs (2026-08-04), which moved every
// customer -- including customerID 3 -- into Retail with no exclusion. This
// script excludes POS_DEFAULT_CUSTOMER_IDS from the bulk move.
//
// Uses the same CRM API pattern as move-all-customers-to-retail.mjs: look up
// the CRM API URL live via getServiceEndpoints, bulk-assign via
// POST /v1/customers/groups/{id}/customers, max 100 customer IDs per call.
//
// Dry run by default: reports how many customers are already in Wholesale vs
// would move, and confirms the excluded IDs' current group. Requires --apply
// to actually move customers.
//
// Run with: node scripts/move-customers-to-wholesale.mjs           (dry run)
//           node scripts/move-customers-to-wholesale.mjs --apply    (writes)
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

const TARGET_GROUP_NAME = 'Wholesale'
// customerID 3 = "POS Customer", the defaultCustomerID on both physical
// registers (Warehouse, Store LA) per check-pos-default-customer.mjs --
// must stay in Retail so walk-in sales show full retail price by default.
const POS_DEFAULT_CUSTOMER_IDS = [3]
const ERPLY_API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`
const BATCH_SIZE = 100 // CRM bulk-assign endpoint's documented max per call

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

async function fetchErplyCrmApiUrl() {
  const body = new URLSearchParams({ clientCode: ERPLY_CLIENT_CODE, request: 'getServiceEndpoints' })
  const res = await fetch(ERPLY_API_URL, { method: 'POST', body })
  if (!res.ok) throw new Error(`getServiceEndpoints HTTP ${res.status}`)
  const json = await res.json()
  const endpoints = json.records?.[0] ?? {}
  const key = Object.keys(endpoints).find((k) => /crm|customer/i.test(k))
  if (!key) throw new Error(`No CRM-like key in getServiceEndpoints response: ${Object.keys(endpoints).join(', ')}`)
  const url = String(endpoints[key]?.url ?? '').replace(/\/+$/, '')
  if (!url) throw new Error(`Key "${key}" had no .url field: ${JSON.stringify(endpoints[key])}`)
  return url
}

async function fetchErplyGroups(crmApiUrl, sessionKey) {
  const res = await fetch(`${crmApiUrl}/v1/customers/groups`, {
    headers: { clientCode: ERPLY_CLIENT_CODE, sessionKey },
  })
  if (!res.ok) throw new Error(`Erply CRM HTTP ${res.status} fetching groups`)
  return res.json()
}

// classic API — paginated, mirrors fetchProductPage's "trust recordsTotal,
// loop until collected" shape from lib/erply.ts.
async function fetchAllCustomers(sessionKey) {
  const pageSize = 300
  let pageNo = 1
  const all = []
  while (true) {
    const data = await erplyPost({
      request: 'getCustomers',
      sessionKey,
      recordsOnPage: String(pageSize),
      pageNo: String(pageNo),
    })
    all.push(...data.records)
    const total = data.status.recordsTotal ?? all.length
    if (all.length >= total || data.records.length === 0) break
    pageNo++
  }
  return all
}

async function bulkAssignGroup(crmApiUrl, sessionKey, groupId, customerIds) {
  const res = await fetch(`${crmApiUrl}/v1/customers/groups/${groupId}/customers`, {
    method: 'POST',
    headers: {
      clientCode: ERPLY_CLIENT_CODE,
      sessionKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ customerIDs: customerIds }),
  })
  if (!res.ok) throw new Error(`Erply CRM HTTP ${res.status} bulk-assigning group ${groupId}`)
  return res.json()
}

async function main() {
  const apply = process.argv.includes('--apply')

  const sessionKey = await erplySessionKey()
  const crmApiUrl = await fetchErplyCrmApiUrl()

  console.log('Fetching current tier groups live (not trusting cached IDs)...')
  const groupsResp = await fetchErplyGroups(crmApiUrl, sessionKey)
  const groups = groupsResp.records ?? groupsResp
  // Erply's CRM API returns `name` as a localized object ({ en: 'Wholesale' }),
  // not a plain string -- confirmed live 2026-08-04 via check-erply-tier-groups.mjs.
  const wholesaleGroup = groups.find((g) => g.name?.en === TARGET_GROUP_NAME)
  if (!wholesaleGroup) {
    throw new Error(
      `No group named "${TARGET_GROUP_NAME}" found live. Groups seen: ${groups.map((g) => g.name?.en).join(', ')}`,
    )
  }
  console.log(`Wholesale group confirmed live: id ${wholesaleGroup.id}, priceListId ${wholesaleGroup.priceListId}`)

  console.log('Fetching all Erply customers...')
  const customers = await fetchAllCustomers(sessionKey)
  console.log(`Fetched ${customers.length} customers.`)

  const excluded = customers.filter((c) => POS_DEFAULT_CUSTOMER_IDS.includes(Number(c.customerID)))
  console.log(`\nExcluded (POS default customers, must stay out of Wholesale): ${excluded.length}`)
  for (const c of excluded) {
    console.log(`  customerID ${c.customerID} (${c.fullName ?? c.companyName ?? 'unnamed'}) -- currently groupID ${c.groupID}`)
  }

  const eligible = customers.filter((c) => !POS_DEFAULT_CUSTOMER_IDS.includes(Number(c.customerID)))
  const alreadyWholesale = eligible.filter((c) => Number(c.groupID) === Number(wholesaleGroup.id))
  const toMove = eligible.filter((c) => Number(c.groupID) !== Number(wholesaleGroup.id))

  console.log(`\nAlready in Wholesale: ${alreadyWholesale.length}`)
  console.log(`Would move to Wholesale: ${toMove.length}`)
  if (toMove.length > 0) {
    const byCurrentGroup = new Map()
    for (const c of toMove) {
      const key = c.groupID
      byCurrentGroup.set(key, (byCurrentGroup.get(key) ?? 0) + 1)
    }
    console.log('Breakdown by current groupID:', Object.fromEntries(byCurrentGroup))
  }

  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to actually move these customers.')
    return
  }

  console.log(`\n--apply set. Moving ${toMove.length} customers to Wholesale (batches of ${BATCH_SIZE})...`)
  let moved = 0
  for (let i = 0; i < toMove.length; i += BATCH_SIZE) {
    const batch = toMove.slice(i, i + BATCH_SIZE).map((c) => c.customerID)
    await bulkAssignGroup(crmApiUrl, sessionKey, wholesaleGroup.id, batch)
    moved += batch.length
    console.log(`  ${moved}/${toMove.length} moved...`)
  }
  console.log(`\nDone. ${moved} customers moved to Wholesale. customerID(s) ${POS_DEFAULT_CUSTOMER_IDS.join(', ')} left untouched in Retail.`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
