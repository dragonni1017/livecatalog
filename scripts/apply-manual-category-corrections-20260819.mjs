// apply-manual-category-corrections-20260819.mjs
// Run with: node scripts/apply-manual-category-corrections-20260819.mjs [--apply]
//
// Dragon manually corrected the Category column on 46 rows (plus one name
// typo fix, F287833 "3-in1" -> "3-in-1") in a downloaded copy of
// data/all-products-export.xlsx ("all-products-export updated
// 08-19-2026.xlsx" in Downloads) -- diffed against the original checked-in
// export to find exactly what changed. Looks like cleanup of a "Ribbons"
// catch-all bucket into more specific categories (Bows, Papers, Floral
// Basket, etc.).
//
// Applies to Supabase (category_id + the one name fix) and, where a clean
// matching category exists, WooCommerce too. 5 of the 14 target category
// names don't exist verbatim on WooCommerce (it uses more granular/plural
// naming) -- resolved via names already established elsewhere in this
// session's work:
//   Floral Basket -> Floral Baskets (id 169, plural)
//   Plush         -> Plush Toys     (id 192, established plush-category equivalence)
//   Crochet       -> Crochets       (id 158, plural)
//   Toys & Novelties -> Toys        (id 146, established via the nav-link fix)
//   Gifts         -> SKIPPED, no Woo equivalent exists at all (confirmed
//                     earlier this session: the "gifts" slug was a dead
//                     nav-menu typo target, not a real category) -- affects
//                     only B325098, which gets the Supabase update but is
//                     left alone on WooCommerce.
//
// Defaults to a dry run; pass --apply to write. Independently re-fetches
// afterward to confirm.
//
// Requires in .env.local:
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET

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
const WOO_STORE_URL_RAW = process.env.WOO_STORE_URL
const WOO_STORE_URL = WOO_STORE_URL_RAW
  ? (/^https?:\/\//i.test(WOO_STORE_URL_RAW) ? WOO_STORE_URL_RAW : `https://${WOO_STORE_URL_RAW}`).replace(/\/+$/, '')
  : WOO_STORE_URL_RAW
const WOO_CONSUMER_KEY = process.env.WOO_CONSUMER_KEY
const WOO_CONSUMER_SECRET = process.env.WOO_CONSUMER_SECRET
for (const [name, val] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_KEY, WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET })) {
  if (!val) { console.error(`Missing in .env.local: ${name}`); process.exit(1) }
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

// sku -> new Supabase category name (+ optional corrected name)
const CHANGES = [
  { sku: 'B325097', category: 'Bags/Purses' },
  { sku: 'B325098', category: 'Gifts' },
  { sku: 'D701046', category: 'Floral Supplies' },
  { sku: 'D701114', category: 'Floral Supplies' },
  { sku: 'F286605', category: 'Flowers' },
  { sku: 'F286667', category: 'Flowers' },
  { sku: 'F286785', category: 'Deco' },
  { sku: 'F287146', category: 'Floral Supplies' },
  { sku: 'F287326', category: 'Floral Boxes' },
  { sku: 'F287401', category: 'Floral Boxes' },
  { sku: 'F287418', category: 'Flowers' },
  { sku: 'F287462', category: 'Floral Boxes' },
  { sku: 'F287463', category: 'Floral Boxes' },
  { sku: 'F287474', category: 'Bows' },
  { sku: 'F287475', category: 'Bows' },
  { sku: 'F287476', category: 'Bows' },
  { sku: 'F287488', category: 'Floral Supplies' },
  { sku: 'F287489', category: 'Floral Supplies' },
  { sku: 'F287506', category: 'Floral Supplies' },
  { sku: 'F287537', category: 'Floral Basket' },
  { sku: 'F287569', category: 'Bows' },
  { sku: 'F287570', category: 'Bows' },
  { sku: 'F287571', category: 'Bows' },
  { sku: 'F287572', category: 'Bows' },
  { sku: 'F287573', category: 'Bows' },
  { sku: 'F287574', category: 'Bows' },
  { sku: 'F287575', category: 'Papers' },
  { sku: 'F287577', category: 'Papers' },
  { sku: 'F287768', category: 'Floral Basket' },
  { sku: 'F287790', category: 'Floral Basket' },
  { sku: 'F287797', category: 'Papers' },
  { sku: 'F287833', category: 'Floral Boxes', name: '3-in-1 Set Clear Plastic Square Vase - 1/pk 16bx/cs cs.16set' },
  { sku: 'F287848', category: 'Floral Basket' },
  { sku: 'F287849', category: 'Floral Basket' },
  { sku: 'F287850', category: 'Floral Basket' },
  { sku: 'F287872', category: 'Floral Supplies' },
  { sku: 'F561935', category: 'Fan' },
  { sku: 'G333141', category: 'Floral Boxes' },
  { sku: 'G333153', category: 'Gift Bags' },
  { sku: 'G333155', category: 'Gift Bags' },
  { sku: 'G333163', category: 'Floral Supplies' },
  { sku: 'P273718', category: 'Plush' },
  { sku: 'P273719', category: 'Plush' },
  { sku: 'P273756', category: 'Crochet' },
  { sku: 'P282073', category: 'Bags/Purses' },
  { sku: 'T641221', category: 'Toys & Novelties' },
]

// Supabase category name -> WooCommerce category id. null = no clean Woo
// equivalent, skip the Woo push for SKUs targeting that category.
const WOO_CATEGORY_ID = {
  'Bags/Purses': 148,
  'Gifts': null,
  'Floral Supplies': 171,
  'Flowers': 175,
  'Deco': 162,
  'Floral Boxes': 170,
  'Bows': 153,
  'Floral Basket': 169, // "Floral Baskets" on Woo
  'Papers': 187,
  'Fan': 165,
  'Gift Bags': 177,
  'Plush': 192, // "Plush Toys" on Woo
  'Crochet': 158, // "Crochets" on Woo
  'Toys & Novelties': 146, // "Toys" on Woo
}

function wooAuthHeader() {
  return `Basic ${Buffer.from(`${WOO_CONSUMER_KEY}:${WOO_CONSUMER_SECRET}`).toString('base64')}`
}

async function getWooBySku(sku) {
  const res = await fetch(`${WOO_STORE_URL}/wp-json/wc/v3/products?sku=${encodeURIComponent(sku)}&status=any`, { headers: { Authorization: wooAuthHeader() } })
  const data = await res.json()
  return data[0] ?? null
}

async function setWooCategory(id, categoryId) {
  const res = await fetch(`${WOO_STORE_URL}/wp-json/wc/v3/products/${id}`, {
    method: 'PUT',
    headers: { Authorization: wooAuthHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ categories: [{ id: categoryId }] }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`WooCommerce update HTTP ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

async function main() {
  const skus = CHANGES.map(c => c.sku)
  const { data: products, error } = await supabase.from('products').select('id, sku, name, category_id').in('sku', skus)
  if (error) throw new Error(error.message)
  const bySku = new Map(products.map(p => [p.sku, p]))

  const { data: categories, error: catErr } = await supabase.from('categories').select('id, name')
  if (catErr) throw new Error(catErr.message)
  const catIdByName = new Map(categories.map(c => [c.name, c.id]))

  console.log(`${CHANGES.length} products to update:`)
  const skippedWoo = []
  for (const c of CHANGES) {
    const p = bySku.get(c.sku)
    if (!p) { console.error(`ABORT: ${c.sku} not found in Supabase.`); process.exit(1) }
    const targetCatId = catIdByName.get(c.category)
    if (!targetCatId) { console.error(`ABORT: category "${c.category}" not found in Supabase.`); process.exit(1) }
    const wooCatId = WOO_CATEGORY_ID[c.category]
    if (wooCatId === null) skippedWoo.push(c.sku)
    console.log(`  ${c.sku}: category -> "${c.category}"${c.name ? ` | name -> "${c.name}"` : ''}${wooCatId === null ? ' (Woo: skipped, no equivalent)' : ''}`)
  }
  console.log(`\n${skippedWoo.length} SKU(s) will be Supabase-only (no Woo equivalent): ${skippedWoo.join(', ')}`)

  if (!APPLY) {
    console.log('\nDry run only -- pass --apply to write these.')
    return
  }

  console.log('\nUpdating Supabase...')
  for (const c of CHANGES) {
    const p = bySku.get(c.sku)
    const catId = catIdByName.get(c.category)
    const update = { category_id: catId }
    if (c.name) update.name = c.name
    const { error: updateErr } = await supabase.from('products').update(update).eq('id', p.id)
    if (updateErr) { console.error(`  FAILED ${c.sku}: ${updateErr.message}`); continue }
    console.log(`  ${c.sku}: updated`)
  }

  console.log('\nUpdating WooCommerce...')
  for (const c of CHANGES) {
    const wooCatId = WOO_CATEGORY_ID[c.category]
    if (wooCatId === null) continue
    const wp = await getWooBySku(c.sku)
    if (!wp) { console.error(`  FAILED ${c.sku}: not found in WooCommerce`); continue }
    try {
      await setWooCategory(wp.id, wooCatId)
      console.log(`  ${c.sku}: id ${wp.id} -> category ${wooCatId}`)
    } catch (err) {
      console.error(`  FAILED ${c.sku}: ${err.message}`)
    }
  }

  console.log('\nIndependently re-fetching to confirm...')
  const { data: recheck } = await supabase.from('products').select('sku, name, category:categories(name)').in('sku', skus)
  for (const row of recheck) {
    console.log(`  ${row.sku}: Supabase category=${row.category?.name} name="${row.name}"`)
  }
  for (const c of CHANGES) {
    if (WOO_CATEGORY_ID[c.category] === null) continue
    const wp = await getWooBySku(c.sku)
    console.log(`  ${c.sku}: Woo categories=${wp?.categories?.map(x => x.name).join(', ')}`)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
