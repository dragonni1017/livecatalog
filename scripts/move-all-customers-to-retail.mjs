// move-all-customers-to-retail.mjs
//
// Dragon's decision 2026-08-04: move every Erply customer into the Retail
// tier group (currently all 3,461 are in Wholesale, group id 19 — see
// docs/memory/project-erply-customer-tiers.md), and Retail becomes the new
// default for anyone created going forward. Pairs with
// scripts/rebase-prices-to-retail.mjs, which flips product pricing to the
// same retail-is-the-anchor model.
//
// Re-verifies the group list live rather than trusting the group IDs noted
// in project-erply-customer-tiers.md (same caution as that doc's "How to
// apply" section — these are fast-moving live edits).
//
// Uses the same CRM API pattern as scripts/assign-woo-tier-roles.mjs /
// scripts/check-erply-tier-groups.mjs: look up the CRM API URL live via
// getServiceEndpoints (never hardcode the hostname), then call
// POST /v1/customers/groups/{id}/customers, max 100 customer IDs per call
// (confirmed working live 2026-08-03 for the original Wholesale bulk-assign).
//
// Dry run by default: reports how many customers are already in Retail vs
// would move, writes nothing to Erply. Requires --apply to actually move
// customers.
//
// Run with: node scripts/move-all-customers-to-retail.mjs           (dry run)
//           node scripts/move-all-customers-to-retail.mjs --apply    (writes)
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

const TARGET_GROUP_NAME = 'Retail'
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
  // Erply's CRM API returns `name` as a localized object ({ en: 'Retail' }),
  // not a plain string -- confirmed live 2026-08-04 via check-erply-tier-groups.mjs.
  const retailGroup = groups.find((g) => g.name?.en === TARGET_GROUP_NAME)
  if (!retailGroup) {
    throw new Error(
      `No group named "${TARGET_GROUP_NAME}" found live. Groups seen: ${groups.map((g) => g.name?.en).join(', ')}`,
    )
  }
  console.log(`Retail group confirmed live: id ${retailGroup.id}, priceListId ${retailGroup.priceListId}`)

  console.log('Fetching all Erply customers...')
  const customers = await fetchAllCustomers(sessionKey)
  console.log(`Fetched ${customers.length} customers.`)

  const alreadyRetail = customers.filter((c) => Number(c.groupID) === Number(retailGroup.id))
  const toMove = customers.filter((c) => Number(c.groupID) !== Number(retailGroup.id))

  console.log(`\nAlready in Retail: ${alreadyRetail.length}`)
  console.log(`Would move to Retail: ${toMove.length}`)
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

  console.log(`\n--apply set. Moving ${toMove.length} customers to Retail (batches of ${BATCH_SIZE})...`)
  let moved = 0
  for (let i = 0; i < toMove.length; i += BATCH_SIZE) {
    const batch = toMove.slice(i, i + BATCH_SIZE).map((c) => c.customerID)
    await bulkAssignGroup(crmApiUrl, sessionKey, retailGroup.id, batch)
    moved += batch.length
    console.log(`  ${moved}/${toMove.length} moved...`)
  }
  console.log(`\nDone. ${moved} customers moved to Retail.`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
