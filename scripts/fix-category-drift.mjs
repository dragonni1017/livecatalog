// fix-category-drift.mjs
// Run with: node scripts/fix-category-drift.mjs [--apply]
//
// Two category-consistency gaps found while checking whether Supabase,
// Erply, and WooCommerce categorization stay in sync (they don't -- no
// propagation in any direction, confirmed live):
//
// A) F286863 ("10' Purple Gift Bow") was just moved to Supabase's "Bows"
//    category, but Erply (groupID 46 "Floral Boxes") and WooCommerce
//    (category "Floral Boxes") still say otherwise -- brings all three
//    in line with its 8 already-consistent Gift Bow siblings.
//    Erply "Bows" groupID = 8, Woo "Bows" category id = 153 (both read
//    live off SKU F286797, an already-consistent sibling).
//
// B) All 12 new plush products (create-missing-plush-in-erply.mjs) are
//    "Uncategorized" on WooCommerce -- Erply's Products sync doesn't
//    carry category over automatically; the rest of the catalog only
//    looks consistent because of a one-time backfill
//    (assign-woo-product-categories.mjs) that never re-runs. Assigns
//    them to Woo's "Plush Toys" category (id 192, read live off sibling
//    SKU P273808-60cm) to match their already-live siblings. Erply and
//    Supabase already have these correctly grouped as Plush/Plush Toys.
//
// Defaults to a dry run; pass --apply to write. Independently re-fetches
// afterward to confirm.
//
// Requires in .env.local:
//   ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD
//   WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET

import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
config({ path: path.join(ROOT, '.env.local') })

const APPLY = process.argv.includes('--apply')

const ERPLY_CLIENT_CODE = process.env.ERPLY_CLIENT_CODE
const ERPLY_USERNAME = process.env.ERPLY_USERNAME
const ERPLY_PASSWORD = process.env.ERPLY_PASSWORD
const WOO_STORE_URL_RAW = process.env.WOO_STORE_URL
const WOO_STORE_URL = WOO_STORE_URL_RAW
  ? (/^https?:\/\//i.test(WOO_STORE_URL_RAW) ? WOO_STORE_URL_RAW : `https://${WOO_STORE_URL_RAW}`).replace(/\/+$/, '')
  : WOO_STORE_URL_RAW
const WOO_CONSUMER_KEY = process.env.WOO_CONSUMER_KEY
const WOO_CONSUMER_SECRET = process.env.WOO_CONSUMER_SECRET
for (const [name, val] of Object.entries({ ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD, WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET })) {
  if (!val) { console.error(`Missing in .env.local: ${name}`); process.exit(1) }
}
const ERPLY_API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`

const BOWS_ERPLY_GROUP_ID = 8
const BOWS_WOO_CATEGORY_ID = 153
const PLUSH_WOO_CATEGORY_ID = 192

const PLUSH_SKUS = [
  'P273812-60cm', 'P273815-60cm', 'P273798-60cm', 'P273805-60cm',
  'P273807-46cm', 'P273810-46cm', 'P273810-60cm', 'P273816-46cm',
  'P273800-46cm', 'P273803-60cm', 'P273798-46cm', 'P273802-46cm',
]

function wooAuthHeader() {
  return `Basic ${Buffer.from(`${WOO_CONSUMER_KEY}:${WOO_CONSUMER_SECRET}`).toString('base64')}`
}

async function erplyPost(params) {
  const body = new URLSearchParams({ clientCode: ERPLY_CLIENT_CODE, ...params })
  const res = await fetch(ERPLY_API_URL, { method: 'POST', body })
  const json = await res.json()
  if (json.status?.responseStatus === 'error') throw new Error(`Erply error ${json.status.errorCode}: ${json.status.errorField ?? 'unknown'}`)
  return json
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
  console.log('=== A) F286863 -> Bows (Erply groupID 8, Woo category 153) ===')
  console.log('=== B) 12 new plush -> Woo category "Plush Toys" (192) ===')
  console.log(`  ${PLUSH_SKUS.length} SKUs: ${PLUSH_SKUS.join(', ')}`)

  if (!APPLY) {
    console.log('\nDry run only -- pass --apply to write these.')
    return
  }

  const auth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  const sessionKey = auth.records[0].sessionKey

  console.log('\nFixing F286863...')
  const erplyProduct = await erplyPost({ request: 'getProducts', sessionKey, code: 'F286863' })
  const productID = erplyProduct.records[0].productID
  await erplyPost({ request: 'saveProduct', sessionKey, productID: String(productID), groupID: String(BOWS_ERPLY_GROUP_ID) })
  console.log(`  Erply: productID ${productID} -> groupID ${BOWS_ERPLY_GROUP_ID}`)
  const wooBow = await getWooBySku('F286863')
  await setWooCategory(wooBow.id, BOWS_WOO_CATEGORY_ID)
  console.log(`  Woo: id ${wooBow.id} -> category ${BOWS_WOO_CATEGORY_ID}`)

  console.log('\nFixing the 12 new plush products on WooCommerce...')
  for (const sku of PLUSH_SKUS) {
    const wp = await getWooBySku(sku)
    if (!wp) { console.error(`  FAILED ${sku}: not found in WooCommerce`); continue }
    try {
      await setWooCategory(wp.id, PLUSH_WOO_CATEGORY_ID)
      console.log(`  ${sku}: id ${wp.id} -> category ${PLUSH_WOO_CATEGORY_ID}`)
    } catch (err) {
      console.error(`  FAILED ${sku}: ${err.message}`)
    }
  }

  console.log('\nIndependently re-fetching to confirm...')
  const reErply = await erplyPost({ request: 'getProducts', sessionKey, code: 'F286863' })
  console.log(`  F286863 Erply groupName: ${reErply.records[0].groupName}`)
  const reWooBow = await getWooBySku('F286863')
  console.log(`  F286863 Woo categories: ${reWooBow.categories.map((c) => c.name).join(', ')}`)
  for (const sku of PLUSH_SKUS) {
    const wp = await getWooBySku(sku)
    console.log(`  ${sku} Woo categories: ${wp?.categories?.map((c) => c.name).join(', ') ?? '(not found)'}`)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
