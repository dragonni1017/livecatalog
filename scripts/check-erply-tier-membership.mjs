// check-erply-tier-membership.mjs
// Run with: node scripts/check-erply-tier-membership.mjs
//
// Read-only. Answers the still-open question from
// docs/memory/project-erply-customer-tiers.md: how many of the 3,461
// Erply customers are actually in each of the 5 tier groups (Base 20,
// Wholesale 19, Retail 21, Distribution-Chain 22, Exclusive 23), vs the
// original "all still in Wholesale" snapshot.
//
// Uses the classic API's `getCustomers` request with its `groupID` filter
// (confirmed via learn-api.erply.com/requests/getcustomers) -- pass
// recordsOnPage=1 and read status.recordsTotal for a cheap per-group count
// instead of pulling every customer record. Classic API resolves fine from
// both sandboxes and local machines (unlike the CRM API -- see
// scripts/check-erply-tier-groups.mjs), so this is runnable from either.
//
// Requires in .env.local (all pre-existing):
//   ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD
//
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

// Confirmed live 2026-08-03 via scripts/check-erply-tier-groups.mjs.
const TIER_GROUPS = [
  { name: 'Base', id: 20 },
  { name: 'Wholesale', id: 19 },
  { name: 'Retail', id: 21 },
  { name: 'Distribution-Chain', id: 22 },
  { name: 'Exclusive', id: 23 },
]

// The 3 Erply default groups, unrelated to the tier work but worth
// counting too so the totals reconcile against the account-wide count.
const OTHER_GROUPS = [
  { name: 'Default group', id: 14 },
  { name: 'Company', id: 17 },
  { name: 'Individual', id: 18 },
]

async function countInGroup(sessionKey, groupID) {
  const data = await erplyPost({
    request: 'getCustomers',
    sessionKey,
    recordsOnPage: '1',
    pageNo: '1',
    groupID: String(groupID),
  })
  return data.status?.recordsTotal ?? 0
}

async function main() {
  const auth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  const sessionKey = auth.records[0].sessionKey
  console.log('Erply classic auth OK.\n')

  const totalData = await erplyPost({ request: 'getCustomers', sessionKey, recordsOnPage: '1', pageNo: '1' })
  const totalCustomers = totalData.status?.recordsTotal ?? 0
  console.log(`Account-wide customer count (no group filter): ${totalCustomers}\n`)

  console.log('Tier groups:')
  let tierSum = 0
  for (const g of TIER_GROUPS) {
    const count = await countInGroup(sessionKey, g.id)
    tierSum += count
    console.log(`  ${g.name.padEnd(20)} (id ${g.id}): ${count}`)
  }

  console.log('\nOther (non-tier) Erply default groups:')
  let otherSum = 0
  for (const g of OTHER_GROUPS) {
    const count = await countInGroup(sessionKey, g.id)
    otherSum += count
    console.log(`  ${g.name.padEnd(20)} (id ${g.id}): ${count}`)
  }

  console.log(`\nSum of tier groups: ${tierSum}`)
  console.log(`Sum of other groups: ${otherSum}`)
  console.log(`Sum of both: ${tierSum + otherSum}`)
  console.log(`Account-wide total: ${totalCustomers}`)
  if (tierSum + otherSum !== totalCustomers) {
    console.log(
      `\nNote: sums don't match the account-wide total (difference: ${totalCustomers - (tierSum + otherSum)}) -- ` +
        `some customers may be in a group not listed above, or ungrouped. Not necessarily an error.`,
    )
  }
}

main().catch((err) => {
  console.error('Fatal error:', err.message)
  process.exitCode = 1
})
