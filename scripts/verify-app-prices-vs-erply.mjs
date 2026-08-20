// verify-app-prices-vs-erply.mjs
// Read-only: compares every active Supabase product's price_cents against
// what lib/erply.ts's own sync logic (getErplyProducts, the real code path
// used by app/api/sync/route.ts) currently computes from live Erply data.
// Reuses the actual sync function rather than re-deriving the price formula
// by hand, so this can't drift from production logic the way the older
// scripts/_verify_wholesale_sync.mjs did (it hardcoded a stale 1.2 markup,
// superseded by the 2026-08-06 WHOLESALE_DISCOUNT=0.5 flip).
//
// Run with: npx tsx scripts/verify-app-prices-vs-erply.mjs
// (needs tsx, not plain node, since it imports lib/erply.ts directly to
// reuse the real getErplyProducts() logic rather than re-deriving it)
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { getErplyProducts } from '../lib/erply.ts'

config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.local') })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing Supabase env vars.')
  process.exit(1)
}
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

async function fetchAllSupabaseProducts() {
  const all = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('products')
      .select('id, sku, name, price_cents, is_active, manually_hidden')
      .range(from, from + PAGE - 1)
    if (error) { console.error('Supabase read error:', error.message); process.exit(1) }
    all.push(...data)
    if (data.length < PAGE) break
  }
  return all
}

async function main() {
  console.log('Fetching live Erply catalog (this can take a minute)...')
  const erplyProducts = await getErplyProducts()
  console.log(`Erply: ${erplyProducts.length} products.`)

  console.log('Fetching Supabase catalog...')
  const supabaseProducts = await fetchAllSupabaseProducts()
  console.log(`Supabase: ${supabaseProducts.length} products.`)

  const erplyBySku = new Map(erplyProducts.map((p) => [p.sku.toUpperCase(), p]))

  let matched = 0
  let mismatched = 0
  let notInErply = 0
  let skippedInactive = 0
  const mismatches = []

  for (const sp of supabaseProducts) {
    if (!sp.is_active || sp.manually_hidden) { skippedInactive++; continue }
    const sku = (sp.sku || '').toUpperCase()
    const ep = erplyBySku.get(sku)
    if (!ep) { notInErply++; continue }

    const expectedCents = Math.round(ep.price * 100)
    if (expectedCents === sp.price_cents) {
      matched++
    } else {
      mismatched++
      mismatches.push({
        sku: sp.sku,
        name: sp.name,
        supabase_price: (sp.price_cents / 100).toFixed(2),
        expected_price: (expectedCents / 100).toFixed(2),
        diff_cents: sp.price_cents - expectedCents,
      })
    }
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log(`Active, visible products checked: ${matched + mismatched}`)
  console.log(`  Matched:              ${matched}`)
  console.log(`  Mismatched:           ${mismatched}`)
  console.log(`  Not found in Erply:   ${notInErply}`)
  console.log(`  Skipped (inactive/hidden in Supabase): ${skippedInactive}`)
  console.log(`${'='.repeat(60)}`)

  if (mismatches.length > 0) {
    console.log(`\nFirst ${Math.min(30, mismatches.length)} mismatches:`)
    for (const m of mismatches.slice(0, 30)) {
      console.log(`  ${m.sku} (${m.name}): Supabase $${m.supabase_price}, expected $${m.expected_price} (diff ${m.diff_cents}c)`)
    }
    if (mismatches.length > 30) {
      console.log(`  ... and ${mismatches.length - 30} more`)
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
