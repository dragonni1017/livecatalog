// zero-price-visibility.mjs
// Run with: node scripts/zero-price-visibility.mjs --hide            (dry run)
//           node scripts/zero-price-visibility.mjs --hide --apply
//           node scripts/zero-price-visibility.mjs --unhide          (dry run)
//           node scripts/zero-price-visibility.mjs --unhide --apply
//
// The two halves of the $0.00 problem this catalog has because Erply cannot
// accept a price over the API on this account (proven 2026-09-16, six
// parameter combinations): every product created from a received container
// exists in Erply at price 0 until someone prices it by hand, and the Erply
// sync maps that straight through to price_cents = 0.
//
// A $0.00 product is not merely ugly: app/(catalog) shows any row with
// is_active && !manually_hidden, and lib/order-submission.ts re-checks only
// those same two flags, so a customer can put a free product on a real order.
//
//   --hide    every visible product priced at 0 becomes manually_hidden.
//             Catches rows that pre-date the insert-time guard in
//             lib/product-sync.ts (which only hides products it inserts).
//
//   --unhide  the reverse, for products that have since been priced in Erply
//             and re-synced. Deliberately NOT "every hidden product with a
//             price" -- 144 products are hidden by choice and must stay that
//             way. The cohort is exactly the SKUs this catalog created from a
//             received container (shipment_lines.erply_created_product_id is
//             set), plus anything passed to --include-sku.
//
// Dry run by default. --apply writes a CSV of what it changed to data/ first,
// same as the other bulk scripts here.
//
// Requires in .env.local: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const APPLY = process.argv.includes('--apply')
const HIDE = process.argv.includes('--hide')
const UNHIDE = process.argv.includes('--unhide')
const includeArg = process.argv.find((a) => a.startsWith('--include-sku='))
const INCLUDE = includeArg ? includeArg.split('=')[1].split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : []

if (HIDE === UNHIDE) {
  console.error('Pass exactly one of --hide or --unhide.')
  process.exit(1)
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}
const db = createClient(SUPABASE_URL, SERVICE_KEY)

async function selectAll(table, columns, tweak = (q) => q) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await tweak(db.from(table).select(columns).range(from, from + 999))
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...(data ?? []))
    if ((data ?? []).length < 1000) break
  }
  return out
}

const products = await selectAll('products', 'id, sku, name, price_cents, stock_qty, is_active, manually_hidden, created_at')

let targets
if (HIDE) {
  targets = products.filter((p) => p.is_active && !p.manually_hidden && (p.price_cents ?? 0) <= 0)
} else {
  const lines = await selectAll('shipment_lines', 'sku, erply_created_product_id')
  const cohort = new Set(
    lines.filter((l) => l.erply_created_product_id).map((l) => String(l.sku).toUpperCase()),
  )
  INCLUDE.forEach((s) => cohort.add(s))
  targets = products.filter(
    (p) => p.manually_hidden && (p.price_cents ?? 0) > 0 && cohort.has(String(p.sku).toUpperCase()),
  )
}

const verb = HIDE ? 'HIDE' : 'UNHIDE'
console.log(`${targets.length} product(s) to ${verb}${APPLY ? '' : '  (dry run — nothing written)'}\n`)
for (const p of targets) {
  console.log(`  ${p.sku.padEnd(20)} $${((p.price_cents ?? 0) / 100).toFixed(2).padStart(8)}  stock ${String(p.stock_qty ?? 0).padStart(6)}  ${String(p.name).slice(0, 60)}`)
}
if (targets.length === 0 || !APPLY) {
  if (!APPLY && targets.length > 0) console.log('\nRe-run with --apply to write.')
  process.exit(0)
}

const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '')
const csvPath = path.join(ROOT, 'data', `zero-price-${HIDE ? 'hidden' : 'unhidden'}-${stamp}.csv`)
const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
fs.writeFileSync(
  csvPath,
  ['sku,name,price_cents,manually_hidden_before,manually_hidden_after']
    .concat(targets.map((p) => [p.sku, esc(p.name), p.price_cents, p.manually_hidden, HIDE].join(',')))
    .join('\n') + '\n',
)
console.log(`\nBackup written: ${path.relative(ROOT, csvPath)}`)

let changed = 0
for (const p of targets) {
  const { error } = await db
    .from('products')
    .update({ manually_hidden: HIDE, updated_at: new Date().toISOString() })
    .eq('id', p.id)
  if (error) console.error(`  ${p.sku}: ${error.message}`)
  else changed++
}
console.log(`${verb}: ${changed}/${targets.length} updated.`)

// Independent re-read rather than trusting the writes.
const { data: after } = await db
  .from('products')
  .select('sku, manually_hidden')
  .in('sku', targets.map((p) => p.sku))
const wrong = (after ?? []).filter((p) => p.manually_hidden !== HIDE)
console.log(wrong.length === 0 ? 'Verified: all rows read back as expected.' : `MISMATCH on ${wrong.length}: ${wrong.map((p) => p.sku).join(', ')}`)
