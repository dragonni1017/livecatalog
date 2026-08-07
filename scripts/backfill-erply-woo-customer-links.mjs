// backfill-erply-woo-customer-links.mjs
//
// Populates erply_woo_customer_links for the ~3,180 customers that already
// exist on BOTH sides (matched by email) but were never linked -- the gap
// that caused the 2026-08-07 duplicate-customer incident (see
// docs/memory/project-erply-duplicate-customer-incident.md): the sync
// route's Woo->Erply direction only checked this table before creating a
// customer, and the table only had 2 rows, so it treated ~3,180 real
// customers as brand-new and created 1,121 duplicates in Erply before being
// caught.
//
// This script is Supabase-only -- it NEVER calls Erply's saveCustomer or
// Woo's createCustomer. It only reads both customer lists and INSERTs link
// rows for confirmed email matches. Cannot create a duplicate by
// construction.
//
// Matching against Erply customerID > 13040 is deliberately excluded --
// that's the known duplicate range from the incident (see
// scripts/cleanup-erply-duplicate-customers.mjs), still pending cleanup as
// of when this script is written. Once cleanup runs, that range simply
// won't exist anymore and this exclusion becomes a no-op.
//
// Dry run by default: prints match counts, writes nothing.
// Run with: node scripts/backfill-erply-woo-customer-links.mjs           (dry run)
//           node scripts/backfill-erply-woo-customer-links.mjs --apply    (writes)
//
// Requires in .env.local: ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD,
// WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET,
// NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

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
// Known duplicate range from the 2026-08-07 incident -- never link to these.
const DUPLICATE_ID_FLOOR = 13041

const KNOWN_TIERS = new Set(['Base', 'Wholesale', 'Retail', 'Distribution-Chain', 'Exclusive'])
const TIER_TO_WOO_ROLE_SLUG = {
  'Distribution-Chain': 'chain',
  Wholesale: 'default_wholesaler',
  Retail: 'retail',
  Exclusive: 'exclusive',
  Base: null,
}

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
  const url = String(endpoints[key]?.url ?? '').replace(/\/+$/, '')
  if (!url) throw new Error('Could not resolve CRM API URL')
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

function wooAuthHeader() {
  const token = Buffer.from(`${WOO_CONSUMER_KEY}:${WOO_CONSUMER_SECRET}`).toString('base64')
  return `Basic ${token}`
}

async function fetchAllWooCustomers() {
  const perPage = 100
  let page = 1
  const all = []
  while (true) {
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
  console.log(`Fetched ${erplyRaw.length} Erply customers (includes the pending-cleanup duplicates).`)

  // Exclude the known duplicate range, then dedupe by email keeping the
  // FIRST occurrence -- customerID ascending order from the API means the
  // original (lower ID) wins naturally once duplicates are excluded above.
  const seenEmails = new Set()
  const erplyByEmail = new Map()
  let excludedDuplicates = 0
  for (const c of erplyRaw) {
    if (Number(c.customerID) >= DUPLICATE_ID_FLOOR) {
      excludedDuplicates++
      continue
    }
    const email = c.email?.trim().toLowerCase()
    if (!email || seenEmails.has(email)) continue
    seenEmails.add(email)
    erplyByEmail.set(email, {
      customerID: String(c.customerID),
      tier: groupTierMap.get(c.groupID) || 'Retail',
    })
  }
  console.log(`Excluded ${excludedDuplicates} known-duplicate-range records. ${erplyByEmail.size} usable original Erply customers.`)

  console.log('\nFetching all WooCommerce customers (role=all)...')
  const wooAll = await fetchAllWooCustomers()
  console.log(`Fetched ${wooAll.length} Woo customers.`)

  console.log('\nFetching existing erply_woo_customer_links rows...')
  const { data: existingLinks, error: linkErr } = await supabase.from('erply_woo_customer_links').select('email, woo_customer_id')
  if (linkErr) throw new Error(`Failed to load existing links: ${linkErr.message}`)
  const linkedEmails = new Set((existingLinks ?? []).map((l) => l.email.toLowerCase()))
  const linkedWooIds = new Set((existingLinks ?? []).map((l) => l.woo_customer_id).filter((id) => id != null))
  console.log(`${linkedEmails.size} customers already linked (will skip).`)

  const toLink = []
  for (const wc of wooAll) {
    if (!wc.email) continue
    const email = wc.email.trim().toLowerCase()
    if (linkedEmails.has(email) || linkedWooIds.has(wc.id)) continue
    const erplyMatch = erplyByEmail.get(email)
    if (!erplyMatch) continue
    toLink.push({ email, wooCustomerId: wc.id, ...erplyMatch })
  }

  console.log(`\n${toLink.length} confirmed email matches ready to link (both sides already exist, just never linked).`)
  console.log('Sample of 5:')
  for (const l of toLink.slice(0, 5)) {
    console.log(`  ${l.email} — erply ${l.customerID} (${l.tier}) <-> woo ${l.wooCustomerId}`)
  }

  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to actually write these link rows.')
    return
  }

  console.log(`\n--apply set. Inserting ${toLink.length} link rows...`)
  let inserted = 0
  let errors = 0
  const BATCH = 500
  for (let i = 0; i < toLink.length; i += BATCH) {
    const batch = toLink.slice(i, i + BATCH).map((l) => ({
      email: l.email,
      erply_customer_id: l.customerID,
      erply_tier: l.tier,
      woo_customer_id: l.wooCustomerId,
      woo_role_slug: TIER_TO_WOO_ROLE_SLUG[l.tier] ?? null,
      last_synced_at: new Date().toISOString(),
      last_sync_source: 'erply',
    }))
    const { error, data } = await supabase.from('erply_woo_customer_links').insert(batch).select('id')
    if (error) {
      errors += batch.length
      console.error(`  batch ${i}-${i + batch.length} failed: ${error.message}`)
    } else {
      inserted += data.length
    }
    console.log(`  ${Math.min(i + BATCH, toLink.length)}/${toLink.length} processed...`)
  }
  console.log(`\nDone. Inserted ${inserted} link rows, ${errors} errors.`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
