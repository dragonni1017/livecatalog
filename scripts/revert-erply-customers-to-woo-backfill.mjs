// revert-erply-customers-to-woo-backfill.mjs
//
// Undoes a run of scripts/backfill-erply-customers-to-woo.mjs using that
// run's own backup CSV (data/erply-woo-customer-backfill/backfill-<runId>.csv).
// Only touches rows logged with action=created in that exact file -- never
// the 6 pre-existing Woo accounts, never action=linked-existing rows (those
// customers existed in Woo before the backfill touched them; deleting them
// would destroy real data the backfill didn't create).
//
// For each action=created row: deletes the WooCommerce customer
// (DELETE wc/v3/customers/{id}?force=true -- WooCommerce customers don't
// support trash, force is required) and removes the matching row from
// erply_woo_customer_links by email. Does NOT touch Erply -- the backfill
// never created Erply customers, only Woo ones, so there's nothing to
// revert on that side.
//
// Dry run by default: prints what would be deleted, deletes nothing.
// Run with: node scripts/revert-erply-customers-to-woo-backfill.mjs <csv-path>            (dry run)
//           node scripts/revert-erply-customers-to-woo-backfill.mjs <csv-path> --apply     (deletes)
//
// Requires in .env.local: WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET,
// NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const WOO_STORE_URL_RAW = process.env.WOO_STORE_URL
const WOO_CONSUMER_KEY = process.env.WOO_CONSUMER_KEY
const WOO_CONSUMER_SECRET = process.env.WOO_CONSUMER_SECRET
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const missing = []
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

function wooAuthHeader() {
  const token = Buffer.from(`${WOO_CONSUMER_KEY}:${WOO_CONSUMER_SECRET}`).toString('base64')
  return `Basic ${token}`
}

async function deleteWooCustomer(wooCustomerId) {
  const res = await fetch(`${WOO_STORE_URL}/wp-json/wc/v3/customers/${wooCustomerId}?force=true`, {
    method: 'DELETE',
    headers: { Authorization: wooAuthHeader() },
  })
  if (!res.ok) throw new Error(`Woo HTTP ${res.status} deleting customer ${wooCustomerId}: ${await res.text()}`)
  return res.json()
}

// Minimal CSV parser -- fields are always double-quoted by the writer in
// backfill-erply-customers-to-woo.mjs, so a simple split-on-quoted-comma is
// sufficient (no embedded newlines in any field we write).
function parseCsv(text) {
  const lines = text.trim().split('\n')
  const header = lines[0].split(',').map((h) => h.replace(/^"|"$/g, ''))
  return lines.slice(1).map((line) => {
    const fields = line.match(/"(?:[^"]|"")*"/g)?.map((f) => f.slice(1, -1).replace(/""/g, '"')) ?? []
    const row = {}
    header.forEach((h, i) => (row[h] = fields[i] ?? ''))
    return row
  })
}

async function main() {
  const csvPath = process.argv[2]
  const apply = process.argv.includes('--apply')
  if (!csvPath) {
    console.error('Usage: node scripts/revert-erply-customers-to-woo-backfill.mjs <csv-path> [--apply]')
    process.exit(1)
  }
  const resolvedPath = path.isAbsolute(csvPath) ? csvPath : path.join(ROOT, csvPath)
  if (!fs.existsSync(resolvedPath)) {
    console.error(`CSV not found: ${resolvedPath}`)
    process.exit(1)
  }

  const rows = parseCsv(fs.readFileSync(resolvedPath, 'utf8'))
  const createdRows = rows.filter((r) => r.action === 'created' && r.woo_customer_id)
  console.log(`Loaded ${rows.length} rows from ${resolvedPath}.`)
  console.log(`  action=created: ${createdRows.length} (these will be deleted)`)
  console.log(`  action=linked-existing: ${rows.filter((r) => r.action === 'linked-existing').length} (left untouched — pre-existed)`)
  console.log(`  action=error: ${rows.filter((r) => r.action === 'error').length} (never created — nothing to revert)`)

  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to actually delete these Woo customers and their link rows.')
    return
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  console.log(`\n--apply set. Deleting ${createdRows.length} Woo customers + link rows...`)
  let deleted = 0
  let errors = 0
  for (const row of createdRows) {
    try {
      await deleteWooCustomer(row.woo_customer_id)
      const { error: delErr } = await supabase.from('erply_woo_customer_links').delete().eq('email', row.email)
      if (delErr) throw new Error(`Supabase delete failed: ${delErr.message}`)
      deleted++
    } catch (err) {
      errors++
      console.error(`  ERROR reverting ${row.email} (woo id ${row.woo_customer_id}): ${err.message}`)
    }
    if (deleted % 200 === 0 && deleted > 0) {
      console.log(`  ${deleted}/${createdRows.length} reverted...`)
    }
  }
  console.log(`\nDone. Reverted ${deleted} Woo customers, ${errors} errors.`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
