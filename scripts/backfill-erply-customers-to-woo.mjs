// backfill-erply-customers-to-woo.mjs
//
// One-time catch-up: creates the ~3,455 Erply customers missing from
// WooCommerce (the third-party import Dragon was told about on 2026-08-04
// never landed -- re-verified live 2026-08-07, Woo still only had 6 junk/
// test accounts). Sets each created customer's Wholesale Suite role to
// match their Erply tier (lib/tier-mapping.ts's TIER_TO_WOO_ROLE, mirrored
// below since this standalone .mjs can't import the TS lib/ file -- keep
// both in sync if either changes).
//
// After this runs, app/api/sync/customers/route.ts (daily cron) takes over
// for the ongoing trickle -- new Erply customers, tier changes, new Woo
// signups. This script is NOT meant to be run repeatedly; it's a one-time
// backfill, but IS safe to re-run/resume if interrupted: it skips any email
// already present in erply_woo_customer_links, and skips creating a Woo
// customer if one already exists for that email (links it instead of
// duplicating).
//
// Rules (Dragon confirmed 2026-08-03, see
// docs/memory/project-woocommerce-tier-mapping.md): customers with no email
// are skipped entirely; when multiple Erply customers share an email, only
// the first is kept.
//
// Backup/revert: every row this script actually creates in Woo (--apply
// only) is logged as it happens to data/erply-woo-customer-backfill/
// backfill-<runId>.csv (action=created|linked-existing|error), so a bad run
// can be undone precisely -- see scripts/revert-erply-customers-to-woo-backfill.mjs,
// which deletes only the action=created rows from that exact CSV (never
// touches the 6 pre-existing Woo accounts or the linked-existing ones).
//
// Dry run by default: prints counts, writes nothing.
// Run with: node scripts/backfill-erply-customers-to-woo.mjs           (dry run)
//           node scripts/backfill-erply-customers-to-woo.mjs --apply    (writes)
//
// Requires in .env.local: ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD,
// WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET,
// NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const ERPLY_CLIENT_CODE = process.env.ERPLY_CLIENT_CODE
const ERPLY_USERNAME = process.env.ERPLY_USERNAME
const ERPLY_PASSWORD = process.env.ERPLY_PASSWORD
const WOO_STORE_URL_RAW = process.env.WOO_STORE_URL
const WOO_CONSUMER_KEY = process.env.WOO_CONSUMER_KEY
const WOO_CONSUMER_SECRET = process.env.WOO_CONSUMER_SECRET
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const missing = []
if (!ERPLY_CLIENT_CODE) missing.push('ERPLY_CLIENT_CODE')
if (!ERPLY_USERNAME) missing.push('ERPLY_USERNAME')
if (!ERPLY_PASSWORD) missing.push('ERPLY_PASSWORD')
if (!WOO_STORE_URL_RAW) missing.push('WOO_STORE_URL')
if (!WOO_CONSUMER_KEY) missing.push('WOO_CONSUMER_KEY')
if (!WOO_CONSUMER_SECRET) missing.push('WOO_CONSUMER_SECRET')
if (!SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL')
if (!SUPABASE_SERVICE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')
if (missing.length > 0) {
  console.error(`Missing in .env.local: ${missing.join(', ')}`)
  process.exit(1)
}

const WOO_STORE_URL = (/^https?:\/\//i.test(WOO_STORE_URL_RAW) ? WOO_STORE_URL_RAW : `https://${WOO_STORE_URL_RAW}`).replace(/\/+$/, '')
const ERPLY_API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`
const CONCURRENCY = 10

// Mirrors lib/tier-mapping.ts -- keep both in sync. term_ids reconfirmed
// live 2026-08-07 via GET wp-json/wholesale/v1/roles.
const DEFAULT_TIER = 'Retail'
const KNOWN_TIERS = new Set(['Base', 'Wholesale', 'Retail', 'Distribution-Chain', 'Exclusive'])
const TIER_TO_WOO_ROLE = {
  'Distribution-Chain': { slug: 'chain' },
  Wholesale: { slug: 'default_wholesaler' },
  Retail: { slug: 'retail' },
  Exclusive: { slug: 'exclusive' },
  Base: null,
}

// ── Erply helpers (mirrors scripts/move-customers-to-wholesale.mjs) ────────────

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
  const json = await erplyPost({ request: 'getServiceEndpoints' })
  const endpoints = json.records?.[0] ?? {}
  const key = Object.keys(endpoints).find((k) => /crm|customer/i.test(k))
  if (!key) throw new Error(`No CRM-like key in getServiceEndpoints response: ${Object.keys(endpoints).join(', ')}`)
  const url = String(endpoints[key]?.url ?? '').replace(/\/+$/, '')
  if (!url) throw new Error(`Key "${key}" had no .url field`)
  return url
}

async function fetchErplyGroups(crmApiUrl, sessionKey) {
  const res = await fetch(`${crmApiUrl}/v1/customers/groups`, {
    headers: { clientCode: ERPLY_CLIENT_CODE, sessionKey },
  })
  if (!res.ok) throw new Error(`Erply CRM HTTP ${res.status} fetching groups`)
  const json = await res.json()
  return json.records ?? json
}

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

// ── Woo helpers (mirrors scripts/check-woo-customer-changes.mjs) ───────────────

function wooAuthHeader() {
  const token = Buffer.from(`${WOO_CONSUMER_KEY}:${WOO_CONSUMER_SECRET}`).toString('base64')
  return `Basic ${token}`
}

async function fetchAllWooCustomers() {
  const perPage = 100
  let page = 1
  const all = []
  while (true) {
    // role=all -- wc/v3/customers defaults to role=customer and silently
    // excludes every Wholesale Suite-tiered account (default_wholesaler,
    // chain, retail, exclusive, distributor). Confirmed live 2026-08-07:
    // without this the endpoint reported 6 total customers when 3,182
    // actually existed -- caused this script's first --apply run to try
    // (and mostly fail on) creating ~2,791 customers that already existed.
    const res = await fetch(`${WOO_STORE_URL}/wp-json/wc/v3/customers?role=all&per_page=${perPage}&page=${page}&orderby=id&order=asc`, {
      headers: { Authorization: wooAuthHeader() },
    })
    if (!res.ok) throw new Error(`Woo HTTP ${res.status} listing customers (page ${page})`)
    const batch = await res.json()
    all.push(...batch)
    if (batch.length < perPage) break
    page++
  }
  return all
}

async function createWooCustomer({ email, firstName, lastName, roleSlug }) {
  const res = await fetch(`${WOO_STORE_URL}/wp-json/wc/v3/customers`, {
    method: 'POST',
    headers: { Authorization: wooAuthHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      first_name: firstName ?? '',
      last_name: lastName ?? '',
      ...(roleSlug ? { role: roleSlug } : {}),
    }),
  })
  if (!res.ok) throw new Error(`Woo HTTP ${res.status} creating customer ${email}: ${await res.text()}`)
  return res.json()
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const apply = process.argv.includes('--apply')
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  const sessionKey = await erplySessionKey()
  const crmApiUrl = await fetchErplyCrmApiUrl()

  console.log('Fetching Erply customer groups (tier names)...')
  const groups = await fetchErplyGroups(crmApiUrl, sessionKey)
  const groupTierMap = new Map()
  for (const g of groups) {
    const name = typeof g.name === 'string' ? g.name : g.name?.en
    if (name && KNOWN_TIERS.has(name)) groupTierMap.set(g.id, name)
  }

  console.log('Fetching all Erply customers...')
  const erplyRaw = await fetchAllCustomers(sessionKey)
  console.log(`Fetched ${erplyRaw.length} Erply customers.`)

  const seenEmails = new Set()
  let skippedNoEmail = 0
  let skippedDupEmail = 0
  const erplyCustomers = []
  for (const c of erplyRaw) {
    const email = c.email?.trim().toLowerCase()
    if (!email) {
      skippedNoEmail++
      continue
    }
    if (seenEmails.has(email)) {
      skippedDupEmail++
      continue
    }
    seenEmails.add(email)
    erplyCustomers.push({
      customerID: String(c.customerID),
      email,
      tier: groupTierMap.get(c.groupID) || DEFAULT_TIER,
      firstName: c.firstName?.trim() || null,
      lastName: c.lastName?.trim() || null,
      companyName: c.companyName?.trim() || null,
    })
  }
  console.log(`Usable: ${erplyCustomers.length}, skipped no-email: ${skippedNoEmail}, skipped dup-email: ${skippedDupEmail}`)

  console.log('\nFetching existing WooCommerce customers...')
  const wooCustomers = await fetchAllWooCustomers()
  const wooByEmail = new Map(wooCustomers.filter((c) => c.email).map((c) => [c.email.toLowerCase(), c]))
  console.log(`Found ${wooCustomers.length} existing Woo customers.`)

  console.log('\nFetching existing erply_woo_customer_links rows (resume support)...')
  const { data: existingLinks, error: linkErr } = await supabase.from('erply_woo_customer_links').select('email')
  if (linkErr) throw new Error(`Failed to load existing links: ${linkErr.message}`)
  const linkedEmails = new Set((existingLinks ?? []).map((l) => l.email.toLowerCase()))
  console.log(`${linkedEmails.size} customers already linked (will skip).`)

  const toProcess = erplyCustomers.filter((c) => !linkedEmails.has(c.email))
  const willCreate = toProcess.filter((c) => !wooByEmail.has(c.email)).length
  const willLinkExisting = toProcess.length - willCreate
  const noRoleCount = toProcess.filter((c) => !TIER_TO_WOO_ROLE[c.tier]).length

  console.log(`\n${toProcess.length} customers to process:`)
  console.log(`  ${willCreate} will be created new in Woo`)
  console.log(`  ${willLinkExisting} already exist in Woo by email (will link, not duplicate)`)
  console.log(`  ${noRoleCount} have a tier with no Woo role (Base — created/linked with no role)`)

  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to actually create/link customers.')
    return
  }

  const dataDir = path.join(ROOT, 'data', 'erply-woo-customer-backfill')
  fs.mkdirSync(dataDir, { recursive: true })
  const runId = new Date().toISOString().replace(/[:.]/g, '-')
  const csvPath = path.join(dataDir, `backfill-${runId}.csv`)
  const csvField = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  fs.writeFileSync(csvPath, 'timestamp,action,email,erply_customer_id,erply_tier,woo_customer_id,woo_role_slug,error_message\n')
  const logRow = (row) =>
    fs.appendFileSync(
      csvPath,
      [row.timestamp, row.action, row.email, row.erplyCustomerId, row.erplyTier, row.wooCustomerId, row.wooRoleSlug, row.errorMessage]
        .map(csvField)
        .join(',') + '\n',
    )

  console.log(`\n--apply set. Backup/revert log: ${csvPath}`)
  console.log(`Processing ${toProcess.length} customers (concurrency ${CONCURRENCY})...`)
  let created = 0
  let linkedExisting = 0
  let errors = 0
  for (let i = 0; i < toProcess.length; i += CONCURRENCY) {
    const batch = toProcess.slice(i, i + CONCURRENCY)
    await Promise.all(
      batch.map(async (c) => {
        const role = TIER_TO_WOO_ROLE[c.tier]
        try {
          let wooCustomer = wooByEmail.get(c.email)
          let action = 'linked-existing'
          if (!wooCustomer) {
            wooCustomer = await createWooCustomer({
              email: c.email,
              firstName: c.firstName,
              lastName: c.lastName || c.companyName,
              roleSlug: role?.slug,
            })
            wooByEmail.set(c.email, wooCustomer)
            action = 'created'
            created++
          } else {
            linkedExisting++
          }
          const { error: insertErr } = await supabase.from('erply_woo_customer_links').insert({
            email: c.email,
            erply_customer_id: c.customerID,
            erply_tier: c.tier,
            woo_customer_id: wooCustomer.id,
            woo_role_slug: role?.slug ?? null,
            last_synced_at: new Date().toISOString(),
            last_sync_source: 'erply',
          })
          if (insertErr) throw new Error(`Supabase insert failed: ${insertErr.message}`)
          logRow({
            timestamp: new Date().toISOString(),
            action,
            email: c.email,
            erplyCustomerId: c.customerID,
            erplyTier: c.tier,
            wooCustomerId: wooCustomer.id,
            wooRoleSlug: role?.slug ?? '',
            errorMessage: '',
          })
        } catch (err) {
          errors++
          console.error(`  ERROR ${c.email}: ${err.message}`)
          logRow({
            timestamp: new Date().toISOString(),
            action: 'error',
            email: c.email,
            erplyCustomerId: c.customerID,
            erplyTier: c.tier,
            wooCustomerId: '',
            wooRoleSlug: role?.slug ?? '',
            errorMessage: err.message,
          })
        }
      }),
    )
    const done = Math.min(i + CONCURRENCY, toProcess.length)
    if (done % 200 < CONCURRENCY || done === toProcess.length) {
      console.log(`  ${done}/${toProcess.length} processed (created:${created} linked-existing:${linkedExisting} errors:${errors})...`)
    }
  }

  console.log(`\nDone. Created ${created} new Woo customers, linked ${linkedExisting} existing, ${errors} errors.`)
  console.log(`Backup/revert log written to: ${csvPath}`)
  console.log(`To undo this run's creates: node scripts/revert-erply-customers-to-woo-backfill.mjs ${csvPath}`)
  if (errors > 0) {
    console.log('Re-run this script (still safe, resumable) to retry the failed ones.')
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
