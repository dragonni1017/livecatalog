// assign-woo-tier-roles.mjs
// BUILT OUT 2026-08-06 — was a skeleton (see git history / this file's old
// header for the original blockers), now a real working bridge. See
// docs/memory/project-woocommerce-tier-mapping.md and
// docs/memory/project-erply-customer-tiers.md for background.
//
// What it does: reads each Erply customer's tier group (classic API
// `getCustomers`, which returns `groupName` directly per customer — no CRM
// API call needed, confirmed live 2026-08-06: candidate approach (a) from
// the old header works, approach (b)/CRM was never needed), matches by
// email to existing WooCommerce customers, and sets the matching
// Wholesale Suite role on their WooCommerce/WordPress account.
//
// Status of the three original blockers, re-verified live 2026-08-06:
//   1. Erply-side segmentation: all 3,461 real customers are now in
//      Wholesale (moved from Retail by a separate session on 2026-08-06 —
//      see chat history, not this repo). Still effectively one group, but
//      that's real live data now, not a reason to hold off running this.
//   2. Woo roles: all 5 now exist (Wholesale/default_wholesaler,
//      Chain/chain, Distributor/distributor, Retail/retail,
//      Exclusive/exclusive) — Retail and Exclusive were created since the
//      2026-08-03 snapshot. TIER_TO_WOO_ROLE below updated accordingly.
//   3. fetchErplyCustomerGroupMembership(): implemented below using
//      approach (a).
//
// UPDATE 2026-08-10: the "6 real customer accounts" constraint below was
// stale by the time this script's --apply path was actually exercised —
// the third-party import landed 2026-08-06 (was hidden by the role-filter
// bug, see project-woocommerce-customer-role-filter-bug.md), so a real run
// now matches ~3,093 of 3,466 Erply customers. Left the original paragraph
// for history:
// Real remaining constraint, NOT a bug in this script: WooCommerce only
// has 6 real customer accounts as of 2026-08-06 (the 3,461-customer
// import from Erply hasn't landed yet). So on a real run today, ~6 or
// fewer Erply customers will find a Woo match (planned-role-changes.csv);
// the rest correctly land in no-woo-match.csv. Re-run this once the import
// lands — matching is by email, live each run, nothing cached.
//
// Dry run by default: writes CSVs, makes ZERO writes to Erply or
// WooCommerce unless run with --apply. Any tier without a mapped Woo role
// is always skipped (logged separately), never blocked on or defaulted to
// some other role. Only ever writes to WooCommerce/WordPress — never
// touches Erply.
//
// Run with: node scripts/assign-woo-tier-roles.mjs           (dry run, writes CSVs only)
//           node scripts/assign-woo-tier-roles.mjs --apply   (writes Woo roles for matched customers)
//
// Requires in .env.local (all pre-existing except the last two, added
// 2026-08-10 — see setWooCustomerRole() below for why wc/v3 keys alone
// aren't enough to write a role):
//   ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD
//   WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET
//   WP_ADMIN_USERNAME, WP_ADMIN_APP_PASSWORD
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
const WP_ADMIN_USERNAME = process.env.WP_ADMIN_USERNAME
const WP_ADMIN_APP_PASSWORD = process.env.WP_ADMIN_APP_PASSWORD

const missing = []
if (!ERPLY_CLIENT_CODE) missing.push('ERPLY_CLIENT_CODE')
if (!ERPLY_USERNAME) missing.push('ERPLY_USERNAME')
if (!ERPLY_PASSWORD) missing.push('ERPLY_PASSWORD')
if (!WOO_STORE_URL) missing.push('WOO_STORE_URL')
if (!WOO_CONSUMER_KEY) missing.push('WOO_CONSUMER_KEY')
if (!WOO_CONSUMER_SECRET) missing.push('WOO_CONSUMER_SECRET')
if (!WP_ADMIN_USERNAME) missing.push('WP_ADMIN_USERNAME')
if (!WP_ADMIN_APP_PASSWORD) missing.push('WP_ADMIN_APP_PASSWORD')
if (missing.length > 0) {
  console.error(`Missing in .env.local: ${missing.join(', ')}`)
  process.exit(1)
}

// ── Tier -> Woo role mapping ─────────────────────────────────────────────
//
// Confirmed live 2026-08-06 via GET wp-json/wholesale/v1/roles: all 5
// Wholesale Suite roles now exist. termId is informational only
// (Wholesale Suite's REST API has no role-assignment endpoint — role is
// set via the standard WP `roles` field on wc/v3/customers, keyed by
// slug, not termId).

// Roles this script will NEVER overwrite, no matter what an Erply match
// says. Confirmed live 2026-08-06: an Erply email collision (two different
// customer records, "Alex Toys" and "Dutch Flowers", both carrying
// conglai@ly-usa.com) matched a WooCommerce account whose real role is
// `administrator` — almost certainly an internal staff account, not a
// wholesale customer, and a naive apply would have demoted it to
// default_wholesaler. Any Woo match currently on one of these roles is
// routed to admin-skipped.csv instead of planned-role-changes.csv and is
// structurally excluded from the --apply write loop below, not just
// filtered by a count.
const NEVER_TOUCH_ROLES = new Set(['administrator', 'editor', 'shop_manager'])

const TIER_TO_WOO_ROLE = {
  'Distribution-Chain': { slug: 'chain', termId: 45 },
  'Wholesale': { slug: 'default_wholesaler', termId: 18 },
  'Retail': { slug: 'retail', termId: null },
  'Exclusive': { slug: 'exclusive', termId: null },
  // Base is intentionally excluded — confirmed decision (see
  // docs/memory/project-tier-auto-suggestion-blocked.md, "SUPERSEDED
  // 2026-08-04" note): Base is meant to have ~zero customers, not a role
  // customers get assigned into. Any Erply customer somehow in Base is
  // skipped to unmapped-tier.csv, same as before.
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

// CONFIRMED WORKING 2026-08-06: classic API getCustomers returns groupName
// directly per customer (candidate approach (a) from the old header) — no
// CRM API call needed at all. Paginates the same accumulate-until-total way
// as every other bulk Erply fetch in this repo (see
// docs/memory/project-erply-pagination-fix.md — don't precompute page count).
// Erply customers can carry multiple semicolon-separated emails in one
// `email` field (confirmed live on real records) — split and keep all of
// them so email-matching against Woo tries each one.
async function fetchErplyCustomerGroupMembership(sessionKey) {
  const pageSize = 200
  let pageNo = 1
  let total = Infinity
  const all = []
  while (all.length < total) {
    const data = await erplyPost({
      request: 'getCustomers',
      sessionKey,
      recordsOnPage: String(pageSize),
      pageNo: String(pageNo),
      orderBy: 'customerID',
    })
    total = data.status.recordsTotal ?? all.length
    all.push(...data.records)
    if (data.records.length === 0) break
    pageNo++
  }
  return all.map((c) => ({
    customerId: c.customerID,
    name: c.fullName || c.companyName || '',
    tierName: c.groupName || '',
    emails: String(c.email || '')
      .split(';')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  }))
}

// ── WooCommerce ──────────────────────────────────────────────────────────

function wooAuthHeader() {
  const token = Buffer.from(`${WOO_CONSUMER_KEY}:${WOO_CONSUMER_SECRET}`).toString('base64')
  return `Basic ${token}`
}

// WOO_CONSUMER_KEY/SECRET (used above) only authorize wc/v3/* routes and
// cannot write a user's role — see setWooCustomerRole() below. This is a
// separate credential: a WordPress Application Password on an admin
// account (Users -> Profile -> Application Passwords), needed for wp/v2/*.
function wpAdminAuthHeader() {
  const token = Buffer.from(`${WP_ADMIN_USERNAME}:${WP_ADMIN_APP_PASSWORD}`).toString('base64')
  return `Basic ${token}`
}

// CORRECTED 2026-08-06: without `role=all`, wc/v3/customers silently
// filters to only role=customer (6 accounts) and hides everyone else --
// confirmed live this cost a false "0 matches, import hasn't landed"
// read on the first test run of this script. With `role=all`, the real
// count is 3,180 WordPress users, most already on Wholesale Suite roles
// (3,152 default_wholesaler, 6 chain, 6 customer, 2 distributor, plus 5
// subscriber / 9 administrator which are non-customer accounts). The
// import DID land; the earlier "hasn't landed" read was this script's own
// bug, not reality. Always pass role=all here.
async function fetchWooCustomers() {
  const perPage = 100
  let pageNo = 1
  const all = []
  while (true) {
    const url = `${WOO_STORE_URL}/wp-json/wc/v3/customers?per_page=${perPage}&page=${pageNo}&role=all`
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

// CORRECTED 2026-08-10: the first real --apply run (3 rows, 2 real
// customers + 1 leftover test account) reported "3 updated, 0 failed" but
// verifying live afterward found NONE of the 3 had actually changed role.
// Root cause: `role` on wc/v3/customers is READ-ONLY in the WooCommerce
// REST API schema — a PUT with `{ role }` returns 200 OK and silently
// drops the field, no error. wp/v2/users (WordPress core) is the only
// route that can write a role, via a `roles` array — but WOO_CONSUMER_KEY/
// SECRET (WooCommerce API keys) aren't valid credentials there, they only
// authorize wc/v3/* (401 rest_cannot_edit_roles). Fixed by using a
// separate WordPress Application Password (WP_ADMIN_USERNAME/
// WP_ADMIN_APP_PASSWORD, see wpAdminAuthHeader() above) against wp/v2.
// Confirmed live: a WooCommerce customer's wc/v3 `id` IS the WP user id
// (registered customers are WP users), so no extra id lookup is needed.
// This function now re-reads the role after writing and throws if it
// didn't actually change — don't trust a 200 response alone, same lesson
// as the saveProduct incident in project-retail-anchor-pricing-flip.md.
async function setWooCustomerRole(customerId, roleSlug) {
  const res = await fetch(`${WOO_STORE_URL}/wp-json/wp/v2/users/${customerId}`, {
    method: 'PUT',
    headers: {
      Authorization: wpAdminAuthHeader(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ roles: [roleSlug] }),
  })
  if (!res.ok) throw new Error(`WordPress HTTP ${res.status} setting role for user ${customerId}`)

  const verify = await fetch(`${WOO_STORE_URL}/wp-json/wp/v2/users/${customerId}?context=edit`, {
    headers: { Authorization: wpAdminAuthHeader() },
  })
  if (!verify.ok) throw new Error(`WordPress HTTP ${verify.status} verifying role for user ${customerId}`)
  const { roles } = await verify.json()
  if (!roles.includes(roleSlug)) {
    throw new Error(`Role write silently no-op for user ${customerId}: expected "${roleSlug}", got [${roles.join(', ')}]`)
  }
  return roles
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

  console.log('Authenticating with Erply...')
  const sessionKey = await erplySessionKey()

  console.log('Fetching Erply customer tier membership (classic getCustomers)...')
  const membership = await fetchErplyCustomerGroupMembership(sessionKey)
  console.log(`  ${membership.length} Erply customers fetched.`)

  console.log('Fetching WooCommerce customers...')
  const wooCustomers = await fetchWooCustomers()
  console.log(`  ${wooCustomers.length} WooCommerce customers fetched.`)
  const wooByEmail = new Map(wooCustomers.map((c) => [c.email, c]))

  const planned = []
  const unmappedTier = []
  const noWooMatch = []
  const adminSkipped = []

  for (const m of membership) {
    const targetRole = TIER_TO_WOO_ROLE[m.tierName]
    if (!targetRole) {
      unmappedTier.push(m)
      continue
    }
    const matchedEmail = m.emails.find((e) => wooByEmail.has(e))
    const wooCustomer = matchedEmail ? wooByEmail.get(matchedEmail) : undefined
    if (!wooCustomer) {
      noWooMatch.push(m)
      continue
    }
    if (NEVER_TOUCH_ROLES.has(wooCustomer.role)) {
      adminSkipped.push({ ...m, matchedEmail, wooCustomerId: wooCustomer.id, currentRole: wooCustomer.role })
      continue
    }
    planned.push({
      ...m,
      matchedEmail,
      wooCustomerId: wooCustomer.id,
      currentRole: wooCustomer.role,
      targetRole: targetRole.slug,
      changeNeeded: wooCustomer.role !== targetRole.slug,
    })
  }

  const reviewDir = path.join(ROOT, 'data', 'woo-tier-review')
  fs.mkdirSync(reviewDir, { recursive: true })

  writeCsv(
    path.join(reviewDir, 'planned-role-changes.csv'),
    ['erplyCustomerId', 'name', 'tierName', 'matchedEmail', 'wooCustomerId', 'currentRole', 'targetRole', 'changeNeeded'],
    planned.map((p) => [p.customerId, p.name, p.tierName, p.matchedEmail, p.wooCustomerId, p.currentRole, p.targetRole, p.changeNeeded]),
  )
  writeCsv(
    path.join(reviewDir, 'unmapped-tier.csv'),
    ['erplyCustomerId', 'name', 'tierName', 'emails'],
    unmappedTier.map((m) => [m.customerId, m.name, m.tierName, m.emails.join(';')]),
  )
  writeCsv(
    path.join(reviewDir, 'no-woo-match.csv'),
    ['erplyCustomerId', 'name', 'tierName', 'emails'],
    noWooMatch.map((m) => [m.customerId, m.name, m.tierName, m.emails.join(';')]),
  )
  writeCsv(
    path.join(reviewDir, 'admin-skipped.csv'),
    ['erplyCustomerId', 'name', 'tierName', 'matchedEmail', 'wooCustomerId', 'currentRole'],
    adminSkipped.map((p) => [p.customerId, p.name, p.tierName, p.matchedEmail, p.wooCustomerId, p.currentRole]),
  )

  const needChange = planned.filter((p) => p.changeNeeded)
  console.log(`\n=== Summary ===`)
  console.log(`Erply customers total: ${membership.length}`)
  console.log(`Matched to a Woo customer by email: ${planned.length + adminSkipped.length}`)
  console.log(`  of those, already on the correct role: ${planned.length - needChange.length}`)
  console.log(`  of those, would change role: ${needChange.length}`)
  console.log(`  of those, on a NEVER_TOUCH_ROLES account (admin/editor/shop_manager) — never written, regardless of --apply: ${adminSkipped.length}`)
  console.log(`Skipped — tier has no mapped Woo role (e.g. Base): ${unmappedTier.length}`)
  console.log(`No matching Woo customer by email: ${noWooMatch.length}`)

  if (adminSkipped.length > 0) {
    console.log('\nADMIN-SKIPPED (never touched, see data/woo-tier-review/admin-skipped.csv):')
    for (const p of adminSkipped) {
      console.log(`  ${p.name} <${p.matchedEmail}> — Erply tier "${p.tierName}" matched Woo account #${p.wooCustomerId} (role: ${p.currentRole}) — SKIPPED, not a customer account`)
    }
  }

  if (needChange.length > 0) {
    console.log('\nWould change role:')
    for (const p of needChange) {
      console.log(`  ${p.name} <${p.matchedEmail}> — "${p.currentRole}" -> "${p.targetRole}"`)
    }
  }

  if (!apply) {
    console.log(`\nDry run only — zero writes made. Re-run with --apply to write ${needChange.length} role change(s) to WooCommerce.`)
    console.log(`CSVs written to data/woo-tier-review/ for full review.`)
    return
  }

  console.log(`\n--apply set. Writing ${needChange.length} role change(s) to WooCommerce (${adminSkipped.length} admin-role accounts excluded)...`)
  let ok = 0
  let failed = 0
  for (const p of needChange) {
    try {
      await setWooCustomerRole(p.wooCustomerId, p.targetRole)
      ok++
      console.log(`  OK: ${p.name} <${p.matchedEmail}> -> ${p.targetRole}`)
    } catch (err) {
      failed++
      console.error(`  FAILED: ${p.name} <${p.matchedEmail}>: ${err.message}`)
    }
  }
  console.log(`\nDone. ${ok} updated, ${failed} failed. ${adminSkipped.length} admin-role accounts were never touched.`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
