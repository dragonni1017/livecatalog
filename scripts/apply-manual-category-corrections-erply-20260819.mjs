// apply-manual-category-corrections-erply-20260819.mjs
// Run with: node scripts/apply-manual-category-corrections-erply-20260819.mjs [--apply]
//
// Third leg of the 2026-08-19 manual category correction (see
// apply-manual-category-corrections-20260819.mjs for the original 46-SKU
// Supabase + WooCommerce update). Erply was never updated in that pass --
// checked live afterward and found 0/46 matched, several still sitting in
// the exact "Ribbons" catch-all bucket the corrections were cleaning up.
//
// 44 of the 46 SKUs get updated here. Two are deliberately excluded:
//   - B325098 (target "Gifts") -- same as Woo, no clean Erply equivalent
//     exists (only the broader parent "Florals/Gifts", productGroupID 61).
//   - F287569 -- doesn't exist in Erply under this SKU at all. Its
//     Supabase barcode (737879096895) resolves in Erply to a completely
//     different, unrelated product (D701113, "3mm & 8mm Beige DIY Pearl
//     Beads") -- a genuine data anomaly, not a lookup bug. Needs manual
//     investigation, not a guessed fix.
//
// Category name -> Erply productGroupID, read live from getProductGroups
// (60 groups total, nested). Matches the same names already established
// for the WooCommerce leg where an exact name isn't present:
//   Floral Basket -> "Floral Baskets" (22), Plush -> "Plush Toys" (46),
//   Crochet -> "Crochets" (12), Toys & Novelties -> "Toys" (56, parent group).
//
// Defaults to a dry run; pass --apply to write. Independently re-fetches
// afterward to confirm.
//
// Requires in .env.local:
//   ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD

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
for (const [name, val] of Object.entries({ ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD })) {
  if (!val) { console.error(`Missing in .env.local: ${name}`); process.exit(1) }
}
const ERPLY_API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`

async function erplyPost(params) {
  const body = new URLSearchParams({ clientCode: ERPLY_CLIENT_CODE, ...params })
  const res = await fetch(ERPLY_API_URL, { method: 'POST', body })
  const json = await res.json()
  if (json.status?.responseStatus === 'error') throw new Error(`Erply error ${json.status.errorCode}: ${json.status.errorField ?? 'unknown'}`)
  return json
}

// sku -> target Supabase/Woo category name (skips B325098, F287569)
const CHANGES = [
  { sku: 'B325097', category: 'Bags/Purses' },
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
  { sku: 'F287833', category: 'Floral Boxes' },
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

const ERPLY_GROUP_ID = {
  'Bags/Purses': 4,
  'Floral Supplies': 24,
  'Flowers': 28,
  'Deco': 16,
  'Floral Boxes': 23,
  'Bows': 8,
  'Floral Basket': 22, // "Floral Baskets" in Erply
  'Papers': 41,
  'Fan': 19,
  'Gift Bags': 30,
  'Plush': 46, // "Plush Toys" in Erply
  'Crochet': 12, // "Crochets" in Erply
  'Toys & Novelties': 56, // "Toys" (parent group) in Erply
}

async function main() {
  console.log(`${CHANGES.length} products to update in Erply (skipping B325098 "Gifts" -- no Erply equivalent -- and F287569 -- barcode collision with an unrelated product, needs manual review):`)
  for (const c of CHANGES) {
    const groupId = ERPLY_GROUP_ID[c.category]
    if (!groupId) { console.error(`ABORT: no Erply group mapped for "${c.category}"`); process.exit(1) }
    console.log(`  ${c.sku}: -> "${c.category}" (groupID ${groupId})`)
  }

  if (!APPLY) {
    console.log('\nDry run only -- pass --apply to write these.')
    return
  }

  const auth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  const sessionKey = auth.records[0].sessionKey

  console.log('\nUpdating Erply...')
  const productIdBySku = new Map()
  for (const c of CHANGES) {
    try {
      const lookup = await erplyPost({ request: 'getProducts', sessionKey, code: c.sku })
      const rec = lookup.records?.[0]
      if (!rec) { console.error(`  FAILED ${c.sku}: not found in Erply`); continue }
      productIdBySku.set(c.sku, rec.productID)
      await erplyPost({ request: 'saveProduct', sessionKey, productID: String(rec.productID), groupID: String(ERPLY_GROUP_ID[c.category]) })
      console.log(`  ${c.sku}: productID ${rec.productID} -> groupID ${ERPLY_GROUP_ID[c.category]}`)
    } catch (err) {
      console.error(`  FAILED ${c.sku}: ${err.message}`)
    }
  }

  console.log('\nIndependently re-fetching to confirm...')
  for (const c of CHANGES) {
    const lookup = await erplyPost({ request: 'getProducts', sessionKey, code: c.sku })
    const rec = lookup.records?.[0]
    console.log(`  ${c.sku}: groupName=${rec?.groupName ?? '(not found)'}`)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
