// cleanup-erply-duplicate-customers.mjs
//
// Removes the duplicate Erply customers created by the 2026-08-07 incident
// (see docs/memory/project-erply-duplicate-customer-incident.md): two
// manual test runs of the (since-fixed) customer sync route created 1,121
// duplicate customers, all in the customerID range >= 13041, all groupID 21
// (Retail), each a duplicate of an already-existing customer with the same
// email at a lower customerID.
//
// Safety: a customerID in the duplicate range is only ever deleted if it
// has a CONFIRMED email match against an original (customerID < 13041)
// record -- never deletes based on ID range alone. Also deletes any
// erply_woo_customer_links row pointing at a deleted duplicate (the buggy
// route linked ~1,000 of them to their correct real Woo customer, but to
// the WRONG erply_customer_id) so no dangling references remain. Re-run
// scripts/backfill-erply-woo-customer-links.mjs afterward to relink those
// Woo customers to the surviving original Erply customer.
//
// Backup/revert: every row this script deletes (--apply only) is logged to
// data/erply-duplicate-cleanup/cleanup-<runId>.csv (original + duplicate
// customerID, email) before the delete call, so the exact set is
// reconstructable even though Erply's deleteCustomer is not known to be
// soft-delete/recoverable.
//
// Dry run by default: prints what would be deleted, deletes nothing.
// Run with: node scripts/cleanup-erply-duplicate-customers.mjs           (dry run)
//           node scripts/cleanup-erply-duplicate-customers.mjs --apply    (deletes)
//
// Requires in .env.local: ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD,
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
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const missing = []
if (!ERPLY_CLIENT_CODE) missing.push('ERPLY_CLIENT_CODE')
if (!ERPLY_USERNAME) missing.push('ERPLY_USERNAME')
if (!ERPLY_PASSWORD) missing.push('ERPLY_PASSWORD')
if (!SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL')
if (!SUPABASE_SERVICE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')
if (missing.length > 0) {
  console.error(`Missing in .env.local: ${missing.join(', ')}`)
  process.exit(1)
}

const ERPLY_API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`
const DUPLICATE_ID_FLOOR = 13041

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

async function deleteCustomer(sessionKey, customerID) {
  return erplyPost({ request: 'deleteCustomer', sessionKey, customerID: String(customerID) })
}

async function main() {
  const apply = process.argv.includes('--apply')
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

  const sessionKey = await erplySessionKey()

  console.log('Fetching all Erply customers...')
  const all = await fetchAllCustomers(sessionKey)
  console.log(`Fetched ${all.length} total.`)

  const originalsByEmail = new Map()
  for (const c of all) {
    if (Number(c.customerID) >= DUPLICATE_ID_FLOOR) continue
    const email = c.email?.trim().toLowerCase()
    if (!email) continue
    if (!originalsByEmail.has(email)) originalsByEmail.set(email, c.customerID)
  }

  const suspects = all.filter((c) => Number(c.customerID) >= DUPLICATE_ID_FLOOR)
  console.log(`${suspects.length} records in the suspect duplicate range (customerID >= ${DUPLICATE_ID_FLOOR}).`)

  const confirmedDuplicates = []
  const unconfirmed = []
  for (const c of suspects) {
    const email = c.email?.trim().toLowerCase()
    const originalId = email ? originalsByEmail.get(email) : undefined
    if (originalId) {
      confirmedDuplicates.push({ duplicateId: c.customerID, originalId, email })
    } else {
      unconfirmed.push(c)
    }
  }

  console.log(`\nConfirmed duplicates (email matches an original customerID < ${DUPLICATE_ID_FLOOR}): ${confirmedDuplicates.length}`)
  console.log(`Unconfirmed (in the suspect range but NO matching original — NOT deleted, needs manual review): ${unconfirmed.length}`)
  if (unconfirmed.length > 0) {
    console.log('Unconfirmed sample:')
    for (const c of unconfirmed.slice(0, 10)) {
      console.log(`  ${c.customerID} | ${c.email || '(no email)'} | ${c.fullName || c.companyName || '(unnamed)'}`)
    }
  }

  console.log('\nSample of 5 confirmed duplicates:')
  for (const d of confirmedDuplicates.slice(0, 5)) {
    console.log(`  ${d.email} — duplicate ${d.duplicateId} -> original ${d.originalId}`)
  }

  const { data: staleLinks } = await supabase
    .from('erply_woo_customer_links')
    .select('id, erply_customer_id')
    .in(
      'erply_customer_id',
      confirmedDuplicates.map((d) => String(d.duplicateId)),
    )
  console.log(`\n${(staleLinks ?? []).length} erply_woo_customer_links rows point at a duplicate — will be deleted too (re-run the link backfill script afterward to relink correctly).`)

  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to actually delete these customers and stale link rows.')
    return
  }

  const dataDir = path.join(ROOT, 'data', 'erply-duplicate-cleanup')
  fs.mkdirSync(dataDir, { recursive: true })
  const runId = new Date().toISOString().replace(/[:.]/g, '-')
  const csvPath = path.join(dataDir, `cleanup-${runId}.csv`)
  fs.writeFileSync(csvPath, 'timestamp,duplicate_customer_id,original_customer_id,email,result,error_message\n')
  const csvField = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const logRow = (row) =>
    fs.appendFileSync(
      csvPath,
      [row.timestamp, row.duplicateId, row.originalId, row.email, row.result, row.errorMessage].map(csvField).join(',') + '\n',
    )

  console.log(`\n--apply set. Backup log: ${csvPath}`)

  // 1. Delete stale link rows pointing at duplicates first (avoid dangling refs mid-run).
  if ((staleLinks ?? []).length > 0) {
    const { error } = await supabase
      .from('erply_woo_customer_links')
      .delete()
      .in(
        'erply_customer_id',
        confirmedDuplicates.map((d) => String(d.duplicateId)),
      )
    if (error) throw new Error(`Failed to delete stale link rows: ${error.message}`)
    console.log(`Deleted ${(staleLinks ?? []).length} stale link rows.`)
  }

  // 2. Delete the duplicate Erply customers.
  console.log(`Deleting ${confirmedDuplicates.length} duplicate Erply customers...`)
  let deleted = 0
  let errors = 0
  for (const d of confirmedDuplicates) {
    try {
      await deleteCustomer(sessionKey, d.duplicateId)
      deleted++
      logRow({ timestamp: new Date().toISOString(), duplicateId: d.duplicateId, originalId: d.originalId, email: d.email, result: 'deleted', errorMessage: '' })
    } catch (err) {
      errors++
      logRow({ timestamp: new Date().toISOString(), duplicateId: d.duplicateId, originalId: d.originalId, email: d.email, result: 'error', errorMessage: err.message })
      console.error(`  ERROR deleting ${d.duplicateId} (${d.email}): ${err.message}`)
    }
    if (deleted % 200 === 0 && deleted > 0) console.log(`  ${deleted}/${confirmedDuplicates.length} deleted...`)
  }

  console.log(`\nDone. Deleted ${deleted} duplicate customers, ${errors} errors.`)
  console.log(`Backup log: ${csvPath}`)
  console.log('Next: re-run scripts/backfill-erply-woo-customer-links.mjs to link the now-un-linked Woo customers to their surviving original Erply customer.')
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
