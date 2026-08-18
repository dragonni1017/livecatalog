// fix-bows-pack-spec-erply-woo.mjs
// Run with: node scripts/fix-bows-pack-spec-erply-woo.mjs [--apply]
//
// Same fix as scripts/fix-bows-pack-spec.mjs (already applied to Supabase),
// applied directly to Erply and WooCommerce as their own separate source
// data -- not relying on Erply's WooCommerce Integration's Products sync to
// carry it over, since that sync has been unreliable/manual-trigger-only in
// past sessions (see docs/memory/project-erply-image-backfill.md).
//
// 8 Gift Bow SKUs: "100/pk 20bx/cs cs.20" -> "20/pk 100bx/cs cs.100"
// (Dragon confirmed: bows are sold by the pack of 20, not by the piece; a
// case is 100 packs. cs.100 intentionally does NOT equal 20*100 -- that's
// the repo's usual convention for products sold by the piece, not this one.)
//
// Defaults to a dry run; pass --apply to write. Independently re-fetches
// both systems after writing to confirm, rather than trusting either API's
// own success response.
//
// Requires in .env.local:
//   ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD
//   WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET

import fs from 'fs'
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

for (const [name, val] of Object.entries({
  ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD, WOO_STORE_URL, WOO_CONSUMER_KEY, WOO_CONSUMER_SECRET,
})) {
  if (!val) { console.error(`Missing in .env.local: ${name}`); process.exit(1) }
}

const ERPLY_API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`

const SKUS = ['F286797', 'F286801', 'F286798', 'F286796', 'F286802', 'F286800', 'F286803', 'F286799']
const OLD_SPEC = '100/pk 20bx/cs cs.20'
const NEW_SPEC = '20/pk 100bx/cs cs.100'

const OUT_DIR = path.join(ROOT, 'data', 'bows-pack-spec-fix')
const OUT_CSV = path.join(OUT_DIR, 'planned-changes-erply-woo.csv')

// ---- Erply ----

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

async function erplySessionKey() {
  const auth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  return auth.records[0].sessionKey
}

async function getErplyProductByCode(sessionKey, code) {
  const data = await erplyPost({ request: 'getProducts', sessionKey, code })
  return data.records?.[0] ?? null
}

async function saveErplyProductName(sessionKey, productID, name) {
  return erplyPost({ request: 'saveProduct', sessionKey, productID: String(productID), name })
}

// ---- WooCommerce ----

function wooAuthHeader() {
  return `Basic ${Buffer.from(`${WOO_CONSUMER_KEY}:${WOO_CONSUMER_SECRET}`).toString('base64')}`
}

async function getWooProductBySku(sku) {
  const url = `${WOO_STORE_URL}/wp-json/wc/v3/products?sku=${encodeURIComponent(sku)}&status=any`
  const res = await fetch(url, { headers: { Authorization: wooAuthHeader() } })
  if (!res.ok) throw new Error(`WooCommerce HTTP ${res.status} for sku ${sku}`)
  const batch = await res.json()
  return batch[0] ?? null
}

async function saveWooProductName(id, name) {
  const res = await fetch(`${WOO_STORE_URL}/wp-json/wc/v3/products/${id}`, {
    method: 'PUT',
    headers: { Authorization: wooAuthHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`WooCommerce update HTTP ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

function toCsv(rows) {
  const esc = (v) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const header = 'sku,system,id,old_name,new_name,status'
  const lines = rows.map((r) => [r.sku, r.system, r.id, esc(r.oldName), esc(r.newName), r.status].join(','))
  return [header, ...lines].join('\n') + '\n'
}

async function main() {
  console.log('Authenticating with Erply...')
  const sessionKey = await erplySessionKey()

  const planned = []

  console.log('\nChecking Erply...')
  for (const sku of SKUS) {
    const product = await getErplyProductByCode(sessionKey, sku)
    if (!product) {
      console.log(`  SKIP ${sku}: not found in Erply`)
      continue
    }
    if (!product.name.includes(OLD_SPEC)) {
      console.log(`  SKIP ${sku}: name doesn't contain the expected old spec -- "${product.name}"`)
      continue
    }
    const newName = product.name.replace(OLD_SPEC, NEW_SPEC)
    planned.push({ sku, system: 'erply', id: product.productID, oldName: product.name, newName, status: 'pending' })
    console.log(`  ${sku} (productID ${product.productID}): "${product.name}" -> "${newName}"`)
  }

  console.log('\nChecking WooCommerce...')
  for (const sku of SKUS) {
    const product = await getWooProductBySku(sku)
    if (!product) {
      console.log(`  SKIP ${sku}: not found in WooCommerce`)
      continue
    }
    if (!product.name.includes(OLD_SPEC)) {
      console.log(`  SKIP ${sku}: name doesn't contain the expected old spec -- "${product.name}"`)
      continue
    }
    const newName = product.name.replace(OLD_SPEC, NEW_SPEC)
    planned.push({ sku, system: 'woo', id: product.id, oldName: product.name, newName, status: 'pending' })
    console.log(`  ${sku} (id ${product.id}): "${product.name}" -> "${newName}"`)
  }

  console.log(`\n${planned.length} changes planned across both systems.`)

  if (!APPLY) {
    console.log('\nDry run only -- pass --apply to write these changes.')
    return
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })

  for (const r of planned) {
    try {
      if (r.system === 'erply') {
        await saveErplyProductName(sessionKey, r.id, r.newName)
      } else {
        await saveWooProductName(r.id, r.newName)
      }
      r.status = 'updated'
      console.log(`  updated ${r.system}/${r.sku}`)
    } catch (err) {
      r.status = `failed: ${err.message}`
      console.error(`  FAILED ${r.system}/${r.sku}:`, err.message)
    }
  }

  fs.writeFileSync(OUT_CSV, toCsv(planned))
  console.log(`\nBackup written to ${path.relative(ROOT, OUT_CSV)}`)

  console.log('\nIndependently re-fetching to confirm...')
  for (const sku of SKUS) {
    const erplyProduct = await getErplyProductByCode(sessionKey, sku)
    const wooProduct = await getWooProductBySku(sku)
    console.log(`  ${sku}`)
    console.log(`    erply: ${erplyProduct?.name ?? '(not found)'}`)
    console.log(`    woo:   ${wooProduct?.name ?? '(not found)'}`)
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
