// deactivate-duplicate-f286606-erply-woo.mjs
// Run with: node scripts/deactivate-duplicate-f286606-erply-woo.mjs [--apply]
//
// F286606-Wt/-Pk/-BLK were deactivated in Supabase on 2026-07-30 as a
// confirmed duplicate-listing bug (see
// docs/memory/project-duplicate-barcode-families.md) but that deactivation
// never touched Erply or WooCommerce -- both still had them active/
// published, so the duplicate listings were still live and orderable on
// the real ly-usa.com storefront. Deactivates them there too:
//   - Erply: saveProduct active=0
//   - WooCommerce: status=draft (matches this repo's established
//     convention for non-customer-facing products, e.g. the 66 drafts
//     from set-woo-outofstock-no-image-not-1000.mjs)
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

const SKUS = ['F286606-Wt', 'F286606-Pk', 'F286606-BLK']

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

async function setWooDraft(id) {
  const res = await fetch(`${WOO_STORE_URL}/wp-json/wc/v3/products/${id}`, {
    method: 'PUT',
    headers: { Authorization: wooAuthHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'draft' }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`WooCommerce update HTTP ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

async function main() {
  console.log(`Will deactivate in Erply (active=0) and WooCommerce (status=draft): ${SKUS.join(', ')}`)
  if (!APPLY) {
    console.log('\nDry run only -- pass --apply to write.')
    return
  }

  const auth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  const sessionKey = auth.records[0].sessionKey

  for (const sku of SKUS) {
    const erplyProduct = await erplyPost({ request: 'getProducts', sessionKey, code: sku })
    const productID = erplyProduct.records[0].productID
    await erplyPost({ request: 'saveProduct', sessionKey, productID: String(productID), active: '0' })
    console.log(`  Erply: ${sku} (productID ${productID}) -> active=0`)

    const wooProduct = await getWooBySku(sku)
    await setWooDraft(wooProduct.id)
    console.log(`  Woo: ${sku} (id ${wooProduct.id}) -> status=draft`)
  }

  console.log('\nIndependently re-fetching to confirm...')
  for (const sku of SKUS) {
    const erplyProduct = await erplyPost({ request: 'getProducts', sessionKey, code: sku })
    const wooProduct = await getWooBySku(sku)
    console.log(`  ${sku}: Erply active=${erplyProduct.records[0].active}, Woo status=${wooProduct.status}`)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
