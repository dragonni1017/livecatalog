// check-erply-tier-groups.mjs
// Run with: node scripts/check-erply-tier-groups.mjs
//
// Read-only. Lists Erply's customer groups (CRM API) and their member
// counts, to re-verify docs/memory/project-erply-customer-tiers.md's
// snapshot ("all 3,461 customers still in one group, id 19") without
// trusting that note to stay accurate over time.
//
// CORRECTED & CONFIRMED WORKING 2026-08-03: earlier version guessed the CRM
// API hostname as `{clientCode}.api-crm-us.erply.com`, which was wrong --
// confirmed ENOTFOUND both from this project's sandbox AND from Dragon's
// own machine. Real pattern (per wiki.erply.com/article/679-which-api-to-use,
// wiki.erply.com/article/1321-crm-customer-api, confirmed live): look up the
// CRM service URL via the classic API's `getServiceEndpoints` call (no auth
// required) -- the "crm" entry is `{ url, documentation }`, and its url
// (`https://api-crm-us.erply.com/`) has NO client-code subdomain, unlike the
// classic API. Send clientCode + sessionKey as headers on the CRM request
// itself, since the URL has no subdomain to imply clientCode. Confirmed live
// 2026-08-03: this returns the account's real customer-group list.
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

// Per wiki.erply.com/article/679-which-api-to-use: getServiceEndpoints
// needs no auth, just clientCode. Returns per-account URLs for each
// microservice API (CRM, PIM, Reports, etc.) -- the doc explicitly warns
// these can change without notice, so this is looked up live every run
// rather than hardcoded.
async function fetchServiceEndpoints() {
  const body = new URLSearchParams({ clientCode: ERPLY_CLIENT_CODE, request: 'getServiceEndpoints' })
  const res = await fetch(ERPLY_API_URL, { method: 'POST', body })
  if (!res.ok) throw new Error(`getServiceEndpoints HTTP ${res.status}`)
  const json = await res.json()
  if (json.status?.responseStatus === 'error') {
    throw new Error(`getServiceEndpoints error ${json.status.errorCode}: ${json.status.errorField ?? 'unknown'}`)
  }
  return json.records?.[0] ?? {}
}

async function main() {
  const authBody = new URLSearchParams({
    clientCode: ERPLY_CLIENT_CODE,
    request: 'verifyUser',
    username: ERPLY_USERNAME,
    password: ERPLY_PASSWORD,
  })
  const authRes = await fetch(ERPLY_API_URL, { method: 'POST', body: authBody })
  if (!authRes.ok) throw new Error(`Erply auth HTTP ${authRes.status}`)
  const authJson = await authRes.json()
  if (authJson.status?.responseStatus === 'error') {
    throw new Error(`Erply auth error ${authJson.status.errorCode}: ${authJson.status.errorField ?? 'unknown'}`)
  }
  const sessionKey = authJson.records[0].sessionKey
  console.log('Erply classic auth OK.')

  const endpoints = await fetchServiceEndpoints()
  console.log('\ngetServiceEndpoints raw response (so we can see the real field names/URLs):')
  console.log(JSON.stringify(endpoints, null, 2))

  // Don't guess the exact key name (e.g. "crmAPIUrl" vs "customerAPIUrl")
  // -- find it by matching keys that look CRM/customer-related, and fall
  // back to printing all keys if nothing matches so this fails loudly
  // instead of silently hitting a wrong/undefined URL.
  const candidateKey = Object.keys(endpoints).find((k) => /crm|customer/i.test(k))
  if (!candidateKey) {
    console.error('\nNo key in getServiceEndpoints looked CRM/customer-related.')
    console.error('Full key list:', Object.keys(endpoints))
    throw new Error('Could not determine CRM API URL from getServiceEndpoints -- see raw response above.')
  }
  // Confirmed live 2026-08-03: each service entry is an object
  // { url, documentation }, not a bare string -- and notably the "crm" url
  // (https://api-crm-us.erply.com/) has NO client-code subdomain at all,
  // unlike the classic API. It's one shared regional endpoint; clientCode
  // is passed as a header instead (see below), same as sessionKey.
  const ERPLY_CRM_API_URL = String(endpoints[candidateKey]?.url ?? '').replace(/\/+$/, '')
  if (!ERPLY_CRM_API_URL) {
    throw new Error(`Key "${candidateKey}" had no .url field: ${JSON.stringify(endpoints[candidateKey])}`)
  }
  console.log(`\nUsing CRM API URL from key "${candidateKey}": ${ERPLY_CRM_API_URL}`)

  let res
  try {
    // Per wiki.erply.com/article/1321-crm-customer-api: "Use an Erply
    // client code and API session key to make requests. (Send these as
    // headers "clientCode" and "sessionKey".)" -- clientCode header was
    // missing before; the CRM endpoint has no subdomain to imply it.
    res = await fetch(`${ERPLY_CRM_API_URL}/v1/customers/groups`, {
      headers: { clientCode: ERPLY_CLIENT_CODE, sessionKey },
    })
  } catch (err) {
    // Surface the underlying cause (ENOTFOUND, ETIMEDOUT, certificate error,
    // etc.) instead of the generic "fetch failed" -- that's what actually
    // tells us whether this is DNS, a firewall/VPN block, or something else.
    console.error(`CRM fetch to ${ERPLY_CRM_API_URL} failed.`)
    console.error('err.message:', err.message)
    console.error('err.cause:', err.cause)
    throw err
  }
  const text = await res.text()
  if (!res.ok) throw new Error(`Erply CRM HTTP ${res.status}: ${text}`)

  let groups
  try {
    groups = JSON.parse(text)
  } catch {
    console.log('CRM API returned non-JSON, printing raw:')
    console.log(text)
    return
  }

  console.log(`\nCRM API reachable. ${Array.isArray(groups) ? groups.length : '?'} customer group(s):\n`)
  console.log(JSON.stringify(groups, null, 2))

  // If the response includes a per-group customer count field, surface it
  // plainly -- exact field name unconfirmed until this actually runs once,
  // so this just dumps the raw records above rather than guessing a field
  // name and silently printing `undefined`.
}

main().catch((err) => {
  console.error('Fatal error:', err.message)
  // Deliberately process.exitCode (not process.exit()) -- forcing an
  // immediate exit while a fetch/DNS handle is still being torn down is
  // what triggers Node's Windows-only libuv crash ("Assertion failed:
  // !(handle->flags & UV_HANDLE_CLOSING), src\\win\\async.c"). Setting the
  // exit code and letting the event loop drain naturally avoids it.
  process.exitCode = 1
})
