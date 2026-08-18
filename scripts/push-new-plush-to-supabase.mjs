// push-new-plush-to-supabase.mjs
// Run with: node scripts/push-new-plush-to-supabase.mjs [--apply]
//
// Inserts the 12 new "weighted companion plush" products (just created in
// Erply -- see scripts/create-missing-plush-in-erply.mjs and
// data/plush-erply-import/created-products.csv for productIDs) into
// Supabase, matching this catalog's schema and the conventions of the 8
// already-live siblings in the same line (checked live via a sibling
// product row, sku P273808-60cm):
//   - category_id cat-074 ("Plush")
//   - price_cents = Erply's $23 list price x 50% wholesale discount,
//     quarter-rounded (matches project-retail-anchor-pricing-flip /
//     project-storefront-wholesale-quarter-rounding) = 1150 ($11.50) flat,
//     same as every existing sibling
//   - description auto-generated in the "N pcs/inner · M inners/case ·
//     cs.M" format used by siblings (all this line's pack specs are 1/pk,
//     so N is always 1)
//   - stock_qty 0 -- these are brand-new SKUs with no real inventory yet,
//     NOT copying the placeholder 999 some existing siblings show
//   - image_url/image_urls left null, needs_photo true (no Cloudinary
//     image exists for these yet -- not fabricating one)
//   - is_active true, manually_hidden false (same as any other new active
//     product; needs_photo tracks the missing-image state without hiding
//     the listing)
//
// New product ids continue the existing prod-NNNNN sequence.
//
// Defaults to a dry run; pass --apply to write. Independently re-fetches
// afterward to confirm.
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

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing Supabase credentials in .env.local.')
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const CATEGORY_ID = 'cat-074' // Plush
const PRICE_CENTS = 1150 // $23 Erply list price x 50% wholesale, matches every sibling

const NEW_PRODUCTS = [
  { sku: 'P273812-60cm', barcode: '737879103418', name: 'Black Bear Weighted Companion Plush - 24inch - 1/pk 12bx/cs cs.12' },
  { sku: 'P273815-60cm', barcode: '737879103449', name: 'Dairy Cow Weighted Companion Plush - 24inch - 1/pk 12bx/cs cs.12' },
  { sku: 'P273798-60cm', barcode: '737879103272', name: 'Red Panda Weighted Paw Companion Plush - 24inch - 1/pk 12bx/cs cs.12' },
  { sku: 'P273805-60cm', barcode: '737879103340', name: 'Turtle Weighted Paw Companion Plush - 24inch - 1/pk 12bx/cs cs.12' },
  { sku: 'P273807-46cm', barcode: '737879104286', name: 'Panda Weighted Paw Companion Plush - 46cm - 1/pk 18bx/cs cs.18' },
  { sku: 'P273810-46cm', barcode: '737879104262', name: 'Unicorn Weighted Paw Companion Plush - 46cm - 1/pk 18bx/cs cs.18' },
  { sku: 'P273810-60cm', barcode: '737879103395', name: 'Unicorn Weighted Paw Companion Plush - 24inch - 1/pk 12bx/cs cs.12' },
  { sku: 'P273816-46cm', barcode: '737879104279', name: 'Axolotl Weighted Paw Companion Plush - 46cm - 1/pk 18bx/cs cs.18' },
  { sku: 'P273800-46cm', barcode: '737879104231', name: 'Brown Bear Weighted Paw Companion Plush - 46cm - 1/pk 18bx/cs cs.18' },
  { sku: 'P273803-60cm', barcode: '01033918056404', name: 'Highland Cow Weighted Paw Companion Plush - 24inch - 1/pk 12bx/cs cs.12' },
  { sku: 'P273798-46cm', barcode: '737879104354', name: 'Red Panda Weighted Paw Companion Plush - 46cm - 1/pk 18bx/cs cs.18' },
  { sku: 'P273802-46cm', barcode: '737879104248', name: 'Triceratops Weighted Paw Companion Plush - 46cm - 1/pk 18bx/cs cs.18' },
]

function buildDescription(name) {
  const m = name.match(/(\d+)\s*\/\s*pk\s+(\d+)\s*bx\s*\/\s*cs\s+cs\.(\d+)/i)
  if (!m) return null
  const [, perPack, packsPerCase, caseTotal] = m
  return `${perPack} pcs/inner · ${packsPerCase} inners/case · cs.${caseTotal}`
}

async function nextProductIds(count) {
  const { data, error } = await supabase.from('products').select('id').order('id', { ascending: false }).limit(1)
  if (error) throw new Error(error.message)
  const highest = Number(data[0].id.replace('prod-', ''))
  return Array.from({ length: count }, (_, i) => `prod-${String(highest + 1 + i).padStart(5, '0')}`)
}

async function main() {
  const { data: existing, error: existingErr } = await supabase
    .from('products')
    .select('sku')
    .in('sku', NEW_PRODUCTS.map((p) => p.sku))
  if (existingErr) throw new Error(existingErr.message)
  if (existing.length > 0) {
    console.error('ABORT: these SKUs already exist in Supabase:', existing.map((r) => r.sku).join(', '))
    process.exit(1)
  }

  const ids = await nextProductIds(NEW_PRODUCTS.length)
  const rows = NEW_PRODUCTS.map((p, i) => ({
    id: ids[i],
    sku: p.sku,
    name: p.name,
    description: buildDescription(p.name),
    price_cents: PRICE_CENTS,
    category_id: CATEGORY_ID,
    stock_qty: 0,
    image_url: null,
    image_urls: [],
    is_active: true,
    manually_hidden: false,
    barcode: p.barcode,
    low_stock_alerted: false,
    low_stock_threshold: null,
    volume_tiers: null,
    unit_type: 'pc',
    needs_photo: true,
  }))

  console.log(`${rows.length} products to insert:`)
  for (const r of rows) console.log(`  ${r.id} | ${r.sku} | ${r.barcode} | "${r.name}"`)

  if (!APPLY) {
    console.log('\nDry run only -- pass --apply to write these to Supabase.')
    return
  }

  const { data: inserted, error: insertErr } = await supabase.from('products').insert(rows).select('id, sku')
  if (insertErr) {
    console.error('Insert failed:', insertErr.message)
    process.exit(1)
  }
  console.log(`\nInserted ${inserted.length}/${rows.length}.`)

  const OUT_DIR = path.join(ROOT, 'data', 'plush-erply-import')
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const esc = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const csv = ['id,sku,barcode,name', ...rows.map((r) => [r.id, r.sku, r.barcode, esc(r.name)].join(','))].join('\n') + '\n'
  fs.writeFileSync(path.join(OUT_DIR, 'supabase-inserted.csv'), csv)
  console.log(`Backup written to ${path.relative(ROOT, path.join(OUT_DIR, 'supabase-inserted.csv'))}`)

  console.log('\nIndependently re-fetching to confirm...')
  const { data: check } = await supabase.from('products').select('id, sku, name, price_cents, category_id, barcode, is_active').in('sku', NEW_PRODUCTS.map((p) => p.sku))
  for (const row of check) console.log(`  ${row.sku}: id=${row.id} price_cents=${row.price_cents} category_id=${row.category_id} barcode=${row.barcode} active=${row.is_active}`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
