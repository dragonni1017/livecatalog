// create-missing-plush-in-erply.mjs
// Run with: node scripts/create-missing-plush-in-erply.mjs [--apply]
//
// Creates 12 new products in Erply for the "weighted companion plush" line
// that a QuickBooks-vs-Erply comparison (companion_plush_catalog.xlsx, in
// Downloads) found missing -- 4 in the 24inch/12-per-case size that just
// hadn't been imported yet, and 8 in the 46cm/18-per-case size (plus the
// Unicorn line entirely) that Erply never carried at all. Barcodes sourced
// from Downloads/Weighted Companion Plush02262026.xlsx (4 of them) and
// Downloads/plushwithbarcode.txt (the remaining 8, supplied by Dragon).
//
// All 8 already-live siblings in this product line (Cappy, Corgie, Duck,
// Shark, Axolotl-60cm, Brown Bear-60cm, Panda-60cm, Sloth) share:
//   - groupID 46 ("Plush Toys")
//   - price $23 flat (Erply's list price for this line, uniform regardless
//     of actual negotiated sale price -- confirmed via getProducts, not a
//     guess) via priceWithVAT (the only real saveProduct price param, see
//     docs/memory/project-retail-anchor-pricing-flip.md)
//   - unitID 8 ("ea"), vatrateID 1, active + displayedInWebshop
//   - name suffix normalized to "1/pk Nbx/cs cs.N" (not the raw QuickBooks
//     "12/cs" phrasing), and "Calm-Panion" -> "Companion" (matches 7/8
//     siblings; only Duck has a "Panion" typo, not worth replicating)
// New products here follow the same conventions for consistency with the
// existing 8 and with how the rest of this catalog names/parses pack specs
// (lib/pack.ts's extractPackSpec).
//
// Does NOT touch Supabase or WooCommerce -- Erply's own WooCommerce
// Integration Products sync (which carries name/price/code, confirmed
// separately from images) should pick these up on its next run. This
// repo's Erply->Supabase sync is not live (see docs/ERPLY-INTEGRATION-
// STATUS-HANDOFF.md), so these won't appear on livecatalog.vercel.app
// without a separate explicit step.
//
// Defaults to a dry run; pass --apply to write. Independently re-fetches
// each created product by code afterward to confirm.
//
// Requires in .env.local: ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD

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
for (const [name, val] of Object.entries({ ERPLY_CLIENT_CODE, ERPLY_USERNAME, ERPLY_PASSWORD })) {
  if (!val) { console.error(`Missing in .env.local: ${name}`); process.exit(1) }
}
const ERPLY_API_URL = `https://${ERPLY_CLIENT_CODE}.erply.com/api/`

const GROUP_ID = 46 // "Plush Toys"
const UNIT_ID = 8 // "ea"
const VATRATE_ID = 1
const PRICE = '23.00' // flat list price for this whole product line, matches all 8 existing siblings

const NEW_PRODUCTS = [
  { code: 'P273812-60cm', barcode: '737879103418', name: 'Black Bear Weighted Companion Plush - 24inch - 1/pk 12bx/cs cs.12' },
  { code: 'P273815-60cm', barcode: '737879103449', name: 'Dairy Cow Weighted Companion Plush - 24inch - 1/pk 12bx/cs cs.12' },
  { code: 'P273798-60cm', barcode: '737879103272', name: 'Red Panda Weighted Paw Companion Plush - 24inch - 1/pk 12bx/cs cs.12' },
  { code: 'P273805-60cm', barcode: '737879103340', name: 'Turtle Weighted Paw Companion Plush - 24inch - 1/pk 12bx/cs cs.12' },
  { code: 'P273807-46cm', barcode: '737879104286', name: 'Panda Weighted Paw Companion Plush - 46cm - 1/pk 18bx/cs cs.18' },
  { code: 'P273810-46cm', barcode: '737879104262', name: 'Unicorn Weighted Paw Companion Plush - 46cm - 1/pk 18bx/cs cs.18' },
  { code: 'P273810-60cm', barcode: '737879103395', name: 'Unicorn Weighted Paw Companion Plush - 24inch - 1/pk 12bx/cs cs.12' },
  { code: 'P273816-46cm', barcode: '737879104279', name: 'Axolotl Weighted Paw Companion Plush - 46cm - 1/pk 18bx/cs cs.18' },
  { code: 'P273800-46cm', barcode: '737879104231', name: 'Brown Bear Weighted Paw Companion Plush - 46cm - 1/pk 18bx/cs cs.18' },
  { code: 'P273803-60cm', barcode: '01033918056404', name: 'Highland Cow Weighted Paw Companion Plush - 24inch - 1/pk 12bx/cs cs.12' },
  { code: 'P273798-46cm', barcode: '737879104354', name: 'Red Panda Weighted Paw Companion Plush - 46cm - 1/pk 18bx/cs cs.18' },
  { code: 'P273802-46cm', barcode: '737879104248', name: 'Triceratops Weighted Paw Companion Plush - 46cm - 1/pk 18bx/cs cs.18' },
]

const OUT_DIR = path.join(ROOT, 'data', 'plush-erply-import')
const OUT_CSV = path.join(OUT_DIR, 'created-products.csv')

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

async function sessionKey() {
  const auth = await erplyPost({ request: 'verifyUser', username: ERPLY_USERNAME, password: ERPLY_PASSWORD })
  return auth.records[0].sessionKey
}

async function getByCode(sk, code) {
  const data = await erplyPost({ request: 'getProducts', sessionKey: sk, code })
  return data.records?.[0] ?? null
}

async function main() {
  const sk = await sessionKey()

  console.log('Checking none of these codes already exist (safety check before creating)...')
  for (const p of NEW_PRODUCTS) {
    const existing = await getByCode(sk, p.code)
    if (existing) {
      console.error(`ABORT: ${p.code} already exists in Erply (productID ${existing.productID}) -- refusing to create a duplicate.`)
      process.exit(1)
    }
  }
  console.log('Confirmed: none of the 12 codes exist yet.\n')

  console.log(`${NEW_PRODUCTS.length} products to create:`)
  for (const p of NEW_PRODUCTS) {
    console.log(`  ${p.code} | barcode ${p.barcode} | "${p.name}"`)
  }

  if (!APPLY) {
    console.log('\nDry run only -- pass --apply to create these in Erply.')
    return
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const created = []

  for (const p of NEW_PRODUCTS) {
    try {
      const res = await erplyPost({
        request: 'saveProduct',
        sessionKey: sk,
        name: p.name,
        code: p.code,
        code2: p.barcode,
        groupID: String(GROUP_ID),
        unitID: String(UNIT_ID),
        vatrateID: String(VATRATE_ID),
        priceWithVAT: PRICE,
        active: '1',
        displayedInWebshop: '1',
      })
      const productID = res.records?.[0]?.productID
      created.push({ ...p, productID, status: 'created' })
      console.log(`  created ${p.code} -> productID ${productID}`)
    } catch (err) {
      created.push({ ...p, productID: null, status: `FAILED: ${err.message}` })
      console.error(`  FAILED ${p.code}: ${err.message}`)
    }
  }

  const esc = (v) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const csv = ['code,barcode,name,productID,status', ...created.map((c) => [c.code, c.barcode, esc(c.name), c.productID ?? '', c.status].join(','))].join('\n') + '\n'
  fs.writeFileSync(OUT_CSV, csv)
  console.log(`\nBackup written to ${path.relative(ROOT, OUT_CSV)}`)

  console.log('\nIndependently re-fetching each by code to confirm...')
  for (const p of NEW_PRODUCTS) {
    const check = await getByCode(sk, p.code)
    if (!check) {
      console.log(`  ${p.code}: NOT FOUND after creation attempt`)
    } else {
      console.log(`  ${p.code}: productID ${check.productID}, code2=${check.code2}, name="${check.name}", groupID=${check.groupID}, price=${check.price}, active=${check.active}`)
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
