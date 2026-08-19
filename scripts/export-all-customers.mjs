// export-all-customers.mjs
// Run with: node scripts/export-all-customers.mjs
//
// Read-only. Full customer export, pulled live from Erply (getCustomers) --
// Erply is the source of truth for customers, and the daily bidirectional
// sync (app/api/sync/customers) keeps WooCommerce's accounts matched to it
// by email (see docs/memory/project-erply-woo-customer-sync.md). Cross-
// references erply_woo_customer_links (Supabase) to flag whether each
// customer also has a linked WooCommerce account.
//
// Meant to run locally, not in a sandbox: Erply's API domain isn't
// network-allowlisted there.
//
// Requires in .env.local:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD
//
// Writes: data/all-customers-export.xlsx
// Writes nothing to Erply, WooCommerce, or Supabase.

import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const XLSX = require('xlsx')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ERPLY_CLIENT_CODE = process.env.ERPLY_CLIENT_CODE
const ERPLY_USERNAME = process.env.ERPLY_USERNAME
const ERPLY_PASSWORD = process.env.ERPLY_PASSWORD

const missing = []
if (!SUPABASE_URL) missing.push('NEXT_PUBLIC_SUPABASE_URL')
if (!SUPABASE_SERVICE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')
if (!ERPLY_CLIENT_CODE) missing.push('ERPLY_CLIENT_CODE')
if (!ERPLY_USERNAME) missing.push('ERPLY_USERNAME')
if (!ERPLY_PASSWORD) missing.push('ERPLY_PASSWORD')
if (missing.length > 0) {
  console.error(`Missing in .env.local: ${missing.join(', ')}`)
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

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

async function fetchAllErplyCustomers() {
  const auth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  const sessionKey = auth.records[0].sessionKey

  const all = []
  let pageNo = 1
  let total = Infinity
  while (all.length < total) {
    const data = await erplyPost({
      request: 'getCustomers',
      sessionKey,
      recordsOnPage: '200',
      pageNo: String(pageNo),
      orderBy: 'customerID',
    })
    total = data.status.recordsTotal ?? all.length
    all.push(...data.records)
    if (data.records.length === 0) break
    if (pageNo % 5 === 0) console.log(`  page ${pageNo}: ${all.length}/${total}`)
    pageNo++
  }
  return all
}

// Paginated -- link table exceeds Supabase's default ~1000-row cap (see
// docs/memory/project-erply-duplicate-customer-incident.md).
async function fetchLinkedErplyIds() {
  const linked = new Set()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase.from('erply_woo_customer_links').select('erply_customer_id').range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    for (const row of data) linked.add(row.erply_customer_id)
    if (data.length < PAGE) break
  }
  return linked
}

async function main() {
  console.log('Fetching all customers from Erply...')
  const customers = await fetchAllErplyCustomers()
  console.log(`  ${customers.length} customers fetched`)

  console.log('Fetching WooCommerce link table from Supabase...')
  const linkedIds = await fetchLinkedErplyIds()
  console.log(`  ${linkedIds.size} linked to a WooCommerce account`)

  const rows = customers
    .map((c) => ({
      'Customer ID': c.customerID,
      Type: c.customerType,
      'Full Name': c.fullName || '',
      'Company Name': c.companyName || '',
      'Tier/Group': c.groupName || '',
      Email: c.email || '',
      Phone: c.phone || '',
      Mobile: c.mobile || '',
      Address: c.address || '',
      City: c.city || '',
      State: c.state || '',
      'Postal Code': c.postalCode || '',
      Country: c.country || '',
      'Discount %': c.discountPercent ?? '',
      'Linked to WooCommerce': linkedIds.has(String(c.customerID)) ? 'YES' : 'NO',
      'Do Not Sell': c.doNotSell ? 'YES' : 'NO',
      'Sales Blocked': c.salesBlocked ? 'YES' : 'NO',
      'Tax Exempt': c.taxExempt ? 'YES' : 'NO',
    }))
    .sort((a, b) => Number(a['Customer ID']) - Number(b['Customer ID']))

  const wb = XLSX.utils.book_new()
  const sheet = XLSX.utils.json_to_sheet(rows)
  sheet['!cols'] = [
    { wch: 12 }, { wch: 10 }, { wch: 24 }, { wch: 26 }, { wch: 14 },
    { wch: 28 }, { wch: 14 }, { wch: 14 }, { wch: 30 }, { wch: 16 },
    { wch: 8 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 18 },
    { wch: 12 }, { wch: 12 }, { wch: 10 },
  ]
  XLSX.utils.book_append_sheet(wb, sheet, 'All Customers')

  const outPath = path.join(ROOT, 'data', 'all-customers-export.xlsx')
  XLSX.writeFile(wb, outPath)
  console.log(`Wrote ${rows.length} rows -> ${outPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
