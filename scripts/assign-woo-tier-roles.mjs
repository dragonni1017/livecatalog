// assign-woo-tier-roles.mjs
// SKELETON — not meaningfully runnable yet. See docs/memory/project-woocommerce-tier-mapping.md
// ("ON HOLD") and docs/memory/project-erply-customer-tiers.md before touching this.
//
// Goal (the one real "bridge" piece identified for the Woo tier mapping,
// per project-woocommerce-tier-mapping.md point 2): read each Erply
// customer's tier group, and set the matching WordPress/Wholesale Suite
// role on their WooCommerce account.
//
// Blocked on three things before this can actually run meaningfully:
//   1. Erply-side segmentation isn't done — all 3,461 customers are still
//      in one group ("Wholesale", group id 19 as of 2026-08-03). Running
//      this today would just confirm everyone into one Woo role, which
//      isn't the goal. See project-erply-customer-tiers.md.
//   2. Only 2 of 5 target Woo roles exist (Chain, Wholesale). Retail,
//      Exclusive, and Base have no Wholesale Suite role yet — TIER_TO_WOO_ROLE
//      below has them as `null` on purpose; DO NOT invent a role/term_id for
//      them here. Create the role in WooCommerce -> Wholesale Suite ->
//      Manage Roles first, then fill in the slug here.
//   3. fetchErplyCustomerGroupMembership() below is UNCONFIRMED — no Erply
//      CRM API call has actually been made yet to read a *customer's*
//      group. The CRM API calls used so far (see
//      project-erply-customer-tiers.md) only ever wrote/read *groups*
//      (POST/PATCH /v1/customers/groups), never a customer's own
//      membership. Two candidate approaches, neither verified live:
//        a) classic API `getCustomers` may return a `groupID` field per
//           customer (same classic API already used for products/sessions
//           in lib/erply.ts) — cheapest to try first, one call.
//        b) CRM API `GET /v1/customers/groups/{id}/customers` (mirrors the
//           bulk-assign endpoint's shape) — paginate per group instead of
//           per customer.
//      Confirm one of these against real data before relying on this
//      function's output.
//
// Even once those are resolved, this script defaults to a dry run: it
// writes a CSV of planned role changes and makes ZERO writes to Erply or
// WooCommerce unless run with --apply. Any tier without a mapped Woo role
// is always skipped (logged separately), never blocked on or defaulted to
// some other role.
//
// Run with: node scripts/assign-woo-tier-roles.mjs           (dry run, writes CSV only)
//           node scripts/assign-woo-tier-roles.mjs --apply   (writes Woo roles — NOT wired up yet, see main())
//
// Requires in .env.local (all pre-existing, same as compare-erply-woo.mjs):
//   ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD
//   WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET
//
// Writes:
//   data/woo-tier-review/planned-role-changes.csv   - erply customer -> matched woo customer -> target role
//   data/woo-tier-review/unmapped-tier.csv          - customers whose Erply tier has no Woo role yet (skipped)
//   data/woo-tier-review/no-woo-match.csv           - Erply customers with no matching Woo customer by email

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
const WOO_STORE_URL_RAW = process.env.WOO_STORE_URL
const WOO_STORE_URL = WOO_STORE_URL_RAW
  ? (/^https?:\/\//i.test(WOO_STORE_URL_RAW) ? WOO_STORE_URL_RAW : `https://${WOO_STORE_URL_RAW}`).replace(/\/+$/, '')
  : WOO_STORE_URL_RAW
const WOO_CONSUMER_KEY = process.env.WOO_CONSUMER_KEY
const WOO_CONSUMER_SECRET = process.env.WOO_CONSUMER_SECRET

const missing = []
if (!ERPLY_CLIENT_CODE) missing.push('ERPLY_CLIENT_CODE')
if (!ERPLY_USERNAME) missing.push('ERPLY_USERNAME')
if (!ERPLY_PASSWORD) missing.push('ERPLY_PASSWORD')
if (!WOO_STORE_URL) missing.push('WOO_STORE_URL')
if (!WOO_CONSUMER_KEY) missing.push('WOO_CONSUMER_KEY')
if (!WOO_CONSUMER_SECRET) missing.push('WOO_CONSUMER_SECRET')
if (missing.length > 0) {
  console.error(`Missing in .env.local: ${missing.join(', ')}`)
  process.exit(1)
}

// ── Tier -> Woo role mapping ─────────────────────────────────────────────
//
// Proposed mapping from docs/memory/project-woocommerce-tier-mapping.md.
// Reuses the 2 Wholesale Suite roles that already exist (confirmed live
// 2026-08-03, both `count: 0`); the other 3 tiers have no role yet.
// termId is informational only (Wholesale Suite's REST API has no
// role-assignment endpoint — see file header point 2 — role is set via the
// standard WP `roles` field, keyed by slug, not termId).

const TIER_TO_WOO_ROLE = {
  'Distribution-Chain': { slug: 'chain', termId: 45 },
  'Wholesale': { slug: 'default_wholesaler', termId: 18 },
  // TODO: create a Wholesale Suite role for Retail, then set its slug here.
  'Retail': null,
  // TODO: create a Wholesale Suite role for Exclusive, then set its slug here.
  'Exclusive': null,
  // TODO: open question, not just a missing role — does "Base" mean no
  // Woo role at all (logged-out/default pricing), or a real role? Resolve
  // before treating this the same as Retail/Exclusive above.
  'Base': null,
}

// ── Erply (CRM API for groups, classic API pattern for everything else) ────

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

// CONFIRMED WORKING 2026-08-03 via scripts/check-erply-tier-groups.mjs:
// do NOT hardcode a CRM hostname like `{clientCode}.api-crm-us.erply.com`
// -- that was wrong (ENOTFOUND from two different machines). Real URL is
// looked up via `getServiceEndpoints` (no auth required); the "crm" entry
// is `{ url, documentation }` (not a bare string), and notably has NO
// client-code subdomain (https://api-crm-us.erply.com/ -- one shared
// regional endpoint, unlike the classic API). "can change without prior
// notice" per Erply's docs, so this is looked up live every run.
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

// Lists the 5 tier groups live rather than trusting hardcoded group IDs —
// same caution as project-erply-customer-tiers.md's "How to apply" note.
// Endpoint shape assumed to mirror the confirmed POST/PATCH
// /v1/customers/groups calls; not yet verified against a live GET.
async function fetchErplyGroups(sessionKey) {
  const crmApiUrl = await fetchErplyCrmApiUrl()
  // Per wiki.erply.com/article/1321-crm-customer-api: send both clientCode
  // and sessionKey as headers -- the CRM endpoint has no subdomain to imply
  // clientCode the way the classic API's URL does.
  const res = await fetch(`${crmApiUrl}/v1/customers/groups`, {
    headers: { clientCode: ERPLY_CLIENT_CODE, sessionKey },
  })
  if (!res.ok) throw new Error(`Erply CRM HTTP ${res.status} fetching groups`)
  return res.json()
}

// UNCONFIRMED — see file header point 3. Do not trust this output without
// verifying live first; both candidate approaches are stubbed as TODOs.
async function fetchErplyCustomerGroupMembership(_sessionKey) {
  throw new Error(
    'fetchErplyCustomerGroupMembership() is not implemented — see file header ' +
      'point 3 for the two unverified candidate approaches (classic getCustomers ' +
      'groupID field vs CRM /v1/customers/groups/{id}/customers).',
  )
}

// ── WooCommerce ──────────────────────────────────────────────────────────

function wooAuthHeader() {
  const token = Buffer.from(`${WOO_CONSUMER_KEY}:${WOO_CONSUMER_SECRET}`).toString('base64')
  return `Basic ${token}`
}

async function fetchWooCustomers() {
  const perPage = 100
  let pageNo = 1
  const all = []
  while (true) {
    const url = `${WOO_STORE_URL}/wp-json/wc/v3/customers?per_page=${perPage}&page=${pageNo}`
    const res = await fetch(url, { headers: { Authorization: wooAuthHeader() } })
    if (!res.ok) throw new Error(`WooCommerce HTTP ${res.status} on customers page ${pageNo}`)
    const batch = await res.json()
    if (!Array.isArray(batch) || batch.length === 0) break
    all.push(...batch)
    if (batch.length < perPage) break
    pageNo++
  }
  return all.map((c) => ({ id: c.id, email: (c.email ?? '').trim().toLowerCase(), role: c.role }))
}

// Not called yet (see main()) — standard wc/v3 update, one customer at a
// time. WooCommerce also supports a /wc/v3/customers/batch endpoint
// (update: [...]) for bulk role sets; switch to that once this is actually
// wired up for 3,461 customers rather than looping one HTTP call each.
async function setWooCustomerRole(customerId, roleSlug) {
  const res = await fetch(`${WOO_STORE_URL}/wp-json/wc/v3/customers/${customerId}`, {
    method: 'PUT',
    headers: {
      Authorization: wooAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ role: roleSlug }),
  })
  if (!res.ok) throw new Error(`WooCommerce HTTP ${res.status} setting role for customer ${customerId}`)
  return res.json()
}

// ── CSV helpers (same convention as compare-erply-woo.mjs) ─────────────────

function csvEscape(value) {
  if (value === null || value === undefined) return ''
  const s = String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function writeCsv(outPath, header, rows) {
  const lines = [header.join(','), ...rows.map((r) => r.map(csvEscape).join(','))]
  fs.writeFileSync(outPath, lines.join('\n') + '\n')
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const apply = process.argv.includes('--apply')

  console.warn(
    'SKELETON: fetchErplyCustomerGroupMembership() is not implemented yet ' +
      '(see file header point 3) — this cannot produce a real plan until it is. ' +
      'Stopping before any network calls.',
  )
  console.warn('Nothing written, nothing called. Fill in the TODOs in this file before running for real.')

  if (apply) {
    console.error('--apply is not wired to anything yet — there is no write path in this skeleton.')
  }
  process.exit(1)

  // Intended flow once the above is resolved:
  //
  // const sessionKey = await erplySessionKey()
  // const groups = await fetchErplyGroups(sessionKey)
  // const membership = await fetchErplyCustomerGroupMembership(sessionKey) // erply customer -> group name
  // const wooCustomers = await fetchWooCustomers()
  // const wooByEmail = new Map(wooCustomers.map((c) => [c.email, c]))
  //
  // const planned = []
  // const unmappedTier = []
  // const noWooMatch = []
  //
  // for (const m of membership) {
  //   const targetRole = TIER_TO_WOO_ROLE[m.tierName]
  //   if (!targetRole) { unmappedTier.push(m); continue }
  //   const wooCustomer = wooByEmail.get(m.email?.toLowerCase())
  //   if (!wooCustomer) { noWooMatch.push(m); continue }
  //   planned.push({ ...m, wooCustomerId: wooCustomer.id, currentRole: wooCustomer.role, targetRole: targetRole.slug })
  // }
  //
  // fs.mkdirSync(path.join(ROOT, 'data', 'woo-tier-review'), { recursive: true })
  // writeCsv(path.join(ROOT, 'data', 'woo-tier-review', 'planned-role-changes.csv'), [...], planned.map(...))
  // writeCsv(path.join(ROOT, 'data', 'woo-tier-review', 'unmapped-tier.csv'), [...], unmappedTier.map(...))
  // writeCsv(path.join(ROOT, 'data', 'woo-tier-review', 'no-woo-match.csv'), [...], noWooMatch.map(...))
  //
  // if (apply) {
  //   for (const p of planned) await setWooCustomerRole(p.wooCustomerId, p.targetRole)
  // } else {
  //   console.log(`Dry run: ${planned.length} role changes planned, 0 applied. Re-run with --apply to write them.`)
  // }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
