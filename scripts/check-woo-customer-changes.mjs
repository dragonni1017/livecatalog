// check-woo-customer-changes.mjs
//
// Read-only check of whether anything has changed on the WooCommerce
// customer side since the 2026-08-04 snapshot in
// docs/memory/project-woocommerce-tier-mapping.md, where Dragon said a
// third-party team was importing Erply's customer list
// (erply-customer.xlsx) directly into WooCommerce and that the two lists
// "should be exactly the same" -- NOT independently verified via API at
// the time. Also checks the flagged live risk: only 2 of 4 needed
// Wholesale Suite roles (Wholesale/default_wholesaler, Chain) existed as
// of 2026-08-03; Retail and Exclusive roles did not exist yet, which could
// cause the import's role-assignment to fail/no-op for those customers.
//
// Checks, all read-only:
//   1. WooCommerce customer count (wc/v3/customers) vs Erply's 3,461
//   2. Wholesale Suite roles (wp-json/wholesale/v1/roles) -- do Retail/
//      Exclusive roles exist yet, and has the customer-per-role count
//      moved off 0/0/0?
//   3. Sample a few Woo customers' roles to see if any tier assignment has
//      actually happened
//
// Requires in .env.local: WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET
// Run with: node check-woo-customer-changes.mjs

import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(__dirname, '..')
config({ path: path.join(REPO_ROOT, '.env.local') })

const WOO_STORE_URL_RAW = process.env.WOO_STORE_URL
const WOO_STORE_URL = WOO_STORE_URL_RAW
  ? (/^https?:\/\//i.test(WOO_STORE_URL_RAW) ? WOO_STORE_URL_RAW : `https://${WOO_STORE_URL_RAW}`).replace(/\/+$/, '')
  : WOO_STORE_URL_RAW
const WOO_CONSUMER_KEY = process.env.WOO_CONSUMER_KEY
const WOO_CONSUMER_SECRET = process.env.WOO_CONSUMER_SECRET

const missing = []
if (!WOO_STORE_URL) missing.push('WOO_STORE_URL')
if (!WOO_CONSUMER_KEY) missing.push('WOO_CONSUMER_KEY')
if (!WOO_CONSUMER_SECRET) missing.push('WOO_CONSUMER_SECRET')
if (missing.length > 0) {
  console.error(`Missing in .env.local: ${missing.join(', ')}`)
  process.exit(1)
}

function wooAuthHeader() {
  const token = Buffer.from(`${WOO_CONSUMER_KEY}:${WOO_CONSUMER_SECRET}`).toString('base64')
  return `Basic ${token}`
}

async function main() {
  console.log('=== WooCommerce customer-side change check ===\n')

  // 1. Customer count via X-WP-Total header (cheap, 1 request)
  //    role=all is required -- confirmed live 2026-08-07 that wc/v3/customers
  //    defaults to role=customer and silently excludes every Wholesale Suite
  //    role (default_wholesaler/chain/retail/exclusive/distributor). Without
  //    it this reported 6 total when 3,182 actually existed -- see
  //    docs/memory/project-woocommerce-customer-role-filter-bug.md.
  console.log('--- 1. WooCommerce customer count ---')
  const custRes = await fetch(`${WOO_STORE_URL}/wp-json/wc/v3/customers?role=all&per_page=1`, {
    headers: { Authorization: wooAuthHeader() },
  })
  if (!custRes.ok) {
    console.error(`  FAILED: HTTP ${custRes.status} ${await custRes.text()}`)
  } else {
    const total = custRes.headers.get('x-wp-total')
    console.log(`  WooCommerce customers: ${total}`)
    console.log(`  Erply customers (known, see docs/memory/project-erply-customer-tiers.md): 3461`)
    console.log(`  ${total == 3461 ? 'MATCH' : `DIFFERS by ${Math.abs(Number(total) - 3461)}`}`)
  }

  // 2. Wholesale Suite roles
  console.log('\n--- 2. Wholesale Suite roles (wp-json/wholesale/v1/roles) ---')
  const rolesRes = await fetch(`${WOO_STORE_URL}/wp-json/wholesale/v1/roles`, {
    headers: { Authorization: wooAuthHeader() },
  })
  if (!rolesRes.ok) {
    console.error(`  FAILED: HTTP ${rolesRes.status} ${await rolesRes.text()}`)
  } else {
    const roles = await rolesRes.json()
    const list = Array.isArray(roles) ? roles : roles.data ?? roles
    console.log(`  ${Array.isArray(list) ? list.length : '?'} roles found:`)
    for (const r of list) {
      console.log(`    "${r.role_name ?? r.name}" (slug ${r.role_key ?? r.slug}) — count: ${r.total_users ?? r.count ?? 'unknown'}`)
    }
    const slugs = list.map((r) => (r.role_key ?? r.slug ?? '').toLowerCase())
    const hasRetail = slugs.some((s) => s.includes('retail'))
    const hasExclusive = slugs.some((s) => s.includes('exclusive'))
    console.log(`  Retail role exists: ${hasRetail ? 'YES (changed since 08-03)' : 'still NO'}`)
    console.log(`  Exclusive role exists: ${hasExclusive ? 'YES (changed since 08-03)' : 'still NO'}`)
  }

  // 3. Sample customers' roles
  console.log('\n--- 3. Sample of 10 most-recently-registered Woo customers ---')
  const sampleRes = await fetch(`${WOO_STORE_URL}/wp-json/wc/v3/customers?role=all&per_page=10&orderby=registered_date&order=desc`, {
    headers: { Authorization: wooAuthHeader() },
  })
  if (!sampleRes.ok) {
    console.error(`  FAILED: HTTP ${sampleRes.status} ${await sampleRes.text()}`)
  } else {
    const customers = await sampleRes.json()
    if (!Array.isArray(customers) || customers.length === 0) {
      console.log('  No customers returned.')
    } else {
      for (const c of customers) {
        console.log(`  ${c.email || '(no email)'} — role: ${c.role ?? 'unknown'}, date_created: ${c.date_created}`)
      }
    }
  }

  console.log('\nRead-only check complete. No writes made anywhere.')
}

main().catch((err) => {
  console.error('Fatal error:', err.message)
  process.exitCode = 1
})
